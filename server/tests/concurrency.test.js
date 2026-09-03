import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  api,
  resetDatabase,
  createUser,
  createProvider,
  futureSlot,
  getPool,
} from './helpers.js';
import { query, closePool, PG_ERRORS } from '../src/db/index.js';
import { addMinutes } from '../src/lib/time.js';

/**
 * The Definition of Done asks for this to be "verified under actual concurrent
 * load, not just manually". So these tests fire genuinely simultaneous writers
 * - N in flight at once, no awaiting between them - and assert that the number
 * of confirmed rows is exactly one. Not "at most one error", not "the second
 * request failed": the row count in the table is the thing being asserted,
 * because that is what a double-booking actually is.
 */

let provider;
let customers;

beforeAll(async () => {
  await resetDatabase();
}, 60_000);

beforeEach(async () => {
  await resetDatabase();
  provider = await createProvider({ slug: 'race-provider', timezone: 'UTC', bufferMinutes: 0 });
  customers = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      createUser({ email: `racer${i}@test.dev`, name: `Racer ${i}`, timezone: 'UTC' }),
    ),
  );
}, 60_000);

afterAll(async () => {
  await closePool();
});

describe('no double-booking under concurrent load', () => {
  it('25 simultaneous requests for the same slot produce exactly one booking', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });

    // Build every request first, then release them together. Nothing is
    // awaited until all 25 are in flight, so they contend for real.
    const attempts = customers.map((c) =>
      api()
        .post('/api/bookings')
        .set('Authorization', c.auth)
        .send({ providerId: provider.id, startsAt, durationMinutes: 30 }),
    );
    const results = await Promise.allSettled(attempts);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : `rejected:${r.reason?.message}`,
    );
    const created = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(24);

    // Losers are told *why*, with a code the UI can branch on.
    const loser = results.find((r) => r.status === 'fulfilled' && r.value.status === 409);
    expect(loser.value.body.error.code).toBe('SLOT_TAKEN');

    // The claim that matters is about the table, not the responses.
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM bookings
        WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it('overlapping - not just identical - start times cannot both survive', async () => {
    // A 30-minute booking at 10:00 and a 30-minute booking at 10:15 overlap.
    // Naive uniqueness on (provider, start_time) would happily accept both;
    // a range exclusion constraint does not.
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });
    const overlapping = addMinutes(startsAt, 15);

    const [a, b] = await Promise.allSettled([
      api()
        .post('/api/bookings')
        .set('Authorization', customers[0].auth)
        .send({ providerId: provider.id, startsAt, durationMinutes: 30 }),
      api()
        .post('/api/bookings')
        .set('Authorization', customers[1].auth)
        // 10:15 is not on the 30-minute grid, so go in below the availability
        // check the way an admin fitting someone in would.
        .send({
          providerId: provider.id,
          startsAt: overlapping,
          durationMinutes: 30,
          skipAvailabilityCheck: true,
        }),
    ]);

    const codes = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(codes.filter((c) => c === 201).length).toBeLessThanOrEqual(1);

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it('the buffer is enforced against concurrent writers too', async () => {
    const buffered = await createProvider({
      slug: 'buffered-provider',
      timezone: 'UTC',
      bufferMinutes: 15,
      slotMinutes: 30,
    });
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });

    // 10:00-10:30 with a 15m buffer reserves until 10:45, so a 10:30 start
    // must lose even though the appointments themselves do not overlap.
    const [a, b] = await Promise.allSettled([
      api()
        .post('/api/bookings')
        .set('Authorization', customers[0].auth)
        .send({ providerId: buffered.id, startsAt, durationMinutes: 30 }),
      api()
        .post('/api/bookings')
        .set('Authorization', customers[1].auth)
        .send({ providerId: buffered.id, startsAt: addMinutes(startsAt, 30), durationMinutes: 30 }),
    ]);

    const created = [a, b].filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    expect(created).toHaveLength(1);

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [buffered.id],
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it('the guarantee holds at the database, below the application entirely', () => {
    // Two raw transactions, bypassing Express, the service layer, the advisory
    // lock and every line of validation. If this holds, no application bug can
    // reintroduce a double-booking, because the protection is not in the
    // application.
    return (async () => {
      const { startsAt } = futureSlot({ weekday: 3, time: '14:00', zone: 'UTC' });
      const endsAt = addMinutes(startsAt, 30);
      const pool = getPool();
      const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);

      const insert = (client) =>
        client.query(
          `INSERT INTO bookings
             (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
              customer_timezone, provider_timezone)
           VALUES ($1,$2,'appointment',$3,$4,0,'UTC','UTC')`,
          [provider.id, customers[0].id, startsAt, endsAt],
        );

      try {
        await Promise.all([c1.query('BEGIN'), c2.query('BEGIN')]);
        await insert(c1);

        // T1 holds an uncommitted row. T2's insert now BLOCKS on T1's xid
        // rather than failing: the exclusion constraint cannot decide until it
        // knows whether T1 commits. This is the exact window in which a
        // check-then-insert in application code would let both through.
        let settled = false;
        const second = insert(c2).then(
          () => { settled = 'ok'; },
          (err) => { settled = err.code; },
        );
        await new Promise((r) => setTimeout(r, 250));
        expect(settled).toBe(false); // still waiting, as it must

        await c1.query('COMMIT');
        await second;

        // Now that T1 has committed, T2 gets a definitive answer.
        expect(settled).toBe(PG_ERRORS.EXCLUSION_VIOLATION);
      } finally {
        // Always end the transaction before handing the connection back: a
        // client released mid-aborted-transaction poisons the pool.
        await c1.query('ROLLBACK').catch(() => {});
        await c2.query('ROLLBACK').catch(() => {});
        c1.release();
        c2.release();
      }

      const { rows } = await query(
        `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
        [provider.id],
      );
      expect(rows[0].n).toBe(1);
    })();
  }, 60_000);

  it('two simultaneous raw inserts still leave exactly one row', async () => {
    // Same race, but with both inserts genuinely in flight at once and no
    // advisory lock to order them. Postgres resolves this as a DEADLOCK rather
    // than an exclusion violation - each transaction is waiting on the other's
    // uncommitted tuple - and kills one. The SQLSTATE differs; the invariant
    // does not. This is why the service layer retries on 40P01 instead of
    // treating it as a server error.
    const { startsAt } = futureSlot({ weekday: 3, time: '16:00', zone: 'UTC' });
    const endsAt = addMinutes(startsAt, 30);
    const pool = getPool();
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);

    const insert = (client) =>
      client.query(
        `INSERT INTO bookings
           (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
            customer_timezone, provider_timezone)
         VALUES ($1,$2,'appointment',$3,$4,0,'UTC','UTC')`,
        [provider.id, customers[0].id, startsAt, endsAt],
      );

    try {
      await Promise.all([c1.query('BEGIN'), c2.query('BEGIN')]);
      const outcomes = await Promise.allSettled([insert(c1), insert(c2)]);

      const failed = outcomes.filter((o) => o.status === 'rejected');
      expect(failed).toHaveLength(1);
      expect([PG_ERRORS.EXCLUSION_VIOLATION, PG_ERRORS.DEADLOCK_DETECTED]).toContain(
        failed[0].reason.code,
      );

      await Promise.all([c1.query('COMMIT').catch(() => {}), c2.query('COMMIT').catch(() => {})]);
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      await c2.query('ROLLBACK').catch(() => {});
      c1.release();
      c2.release();
    }

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it('a cancelled slot is immediately winnable by a concurrent field again', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '11:00', zone: 'UTC' });

    const first = await api()
      .post('/api/bookings')
      .set('Authorization', customers[0].auth)
      .send({ providerId: provider.id, startsAt, durationMinutes: 30 });
    expect(first.status).toBe(201);

    await api()
      .post(`/api/bookings/${first.body.booking.id}/cancel`)
      .set('Authorization', customers[0].auth)
      .send({ reason: 'freeing it up' })
      .expect(200);

    // Everyone piles back in on the freed slot; still exactly one winner.
    const results = await Promise.allSettled(
      customers.slice(1, 11).map((c) =>
        api()
          .post('/api/bookings')
          .set('Authorization', c.auth)
          .send({ providerId: provider.id, startsAt, durationMinutes: 30 }),
      ),
    );
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    expect(created).toHaveLength(1);

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(rows[0].n).toBe(1);
  }, 60_000);

  it('concurrent reschedules onto one slot leave every booking intact', async () => {
    // Three bookings all try to move to the same free slot at once. The winner
    // moves; the losers must still hold their ORIGINAL slot, not be destroyed
    // by a half-applied reschedule.
    const base = futureSlot({ weekday: 3, time: '09:00', zone: 'UTC' }).startsAt;
    const target = futureSlot({ weekday: 3, time: '15:00', zone: 'UTC' }).startsAt;

    const bookings = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await api()
        .post('/api/bookings')
        .set('Authorization', customers[i].auth)
        .send({ providerId: provider.id, startsAt: addMinutes(base, i * 30), durationMinutes: 30 });
      expect(res.status).toBe(201);
      bookings.push({ id: res.body.booking.id, auth: customers[i].auth, original: res.body.booking.startsAt });
    }

    const results = await Promise.allSettled(
      bookings.map((b) =>
        api()
          .post(`/api/bookings/${b.id}/reschedule`)
          .set('Authorization', b.auth)
          .send({ startsAt: target }),
      ),
    );
    const moved = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    expect(moved).toHaveLength(1);

    // Still three confirmed bookings: one at the target, two where they started.
    const { rows } = await query(
      `SELECT starts_at FROM bookings
        WHERE provider_id = $1 AND status = 'confirmed' ORDER BY starts_at`,
      [provider.id],
    );
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.starts_at === target)).toBe(true);
  }, 60_000);
});
