import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { api, resetDatabase, createUser, createProvider, futureSlot } from './helpers.js';
import { query, closePool } from '../src/db/index.js';
import { addMinutes, instantToLocalDate, wallClockToInstant, timeToMinutes } from '../src/lib/time.js';
import { runReminderSweep } from '../src/jobs/reminders.js';

let admin;
let customer;
let providerUser;
let provider;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ email: 'admin@test.dev', role: 'admin', timezone: 'UTC' });
  customer = await createUser({ email: 'cust@test.dev', timezone: 'Asia/Kolkata' });
  providerUser = await createUser({ email: 'pro@test.dev', role: 'provider', timezone: 'UTC' });
  provider = await createProvider({
    slug: 'admin-provider',
    timezone: 'UTC',
    userId: providerUser.id,
    cancellationCutoffHours: 0,
  });
}, 60_000);

afterAll(async () => {
  await closePool();
});

// --------------------------------------------------------- admin blocks ---
describe('admin blocking time', () => {
  it('a block makes the covered slots unbookable', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'UTC' });
    const from = wallClockToInstant(date, timeToMinutes('10:00'), 'UTC');
    const to = wallClockToInstant(date, timeToMinutes('12:00'), 'UTC');

    const before = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'UTC' });
    expect(before.body.count).toBe(16);

    await api()
      .post('/api/admin/blocks')
      .set('Authorization', admin.auth)
      .send({ providerId: provider.id, startsAt: from, endsAt: to, note: 'Team offsite' })
      .expect(201);

    const after = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'UTC' });
    expect(after.body.count).toBe(12); // four 30-minute slots removed

    // And a direct attempt loses to the same constraint a customer would.
    const res = await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt: from, durationMinutes: 30 })
      .expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('refuses to block over an existing booking', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });
    await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt, durationMinutes: 30 })
      .expect(201);

    const res = await api()
      .post('/api/admin/blocks')
      .set('Authorization', admin.auth)
      .send({
        providerId: provider.id,
        startsAt: wallClockToInstant(date, timeToMinutes('09:00'), 'UTC'),
        endsAt: wallClockToInstant(date, timeToMinutes('12:00'), 'UTC'),
      })
      .expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('removing a block frees the time again', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'UTC' });
    const created = await api()
      .post('/api/admin/blocks')
      .set('Authorization', admin.auth)
      .send({
        providerId: provider.id,
        startsAt: wallClockToInstant(date, timeToMinutes('10:00'), 'UTC'),
        endsAt: wallClockToInstant(date, timeToMinutes('11:00'), 'UTC'),
      })
      .expect(201);

    await api()
      .delete(`/api/admin/blocks/${created.body.block.id}`)
      .set('Authorization', admin.auth)
      .expect(204);

    const after = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'UTC' });
    expect(after.body.count).toBe(16);
  });

  it('is closed to non-admins', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });
    await api()
      .post('/api/admin/blocks')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt, endsAt: addMinutes(startsAt, 60) })
      .expect(403);
  });
});

// ------------------------------------------------------- admin calendar ---
describe('admin calendar', () => {
  it('returns bookings across providers, rendered in the admin zone', async () => {
    const second = await createProvider({ slug: 'other-provider', timezone: 'Asia/Tokyo' });
    const a = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });
    const b = futureSlot({ weekday: 3, time: '10:00', zone: 'Asia/Tokyo' });

    await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt: a.startsAt, durationMinutes: 30 })
      .expect(201);
    await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: second.id, startsAt: b.startsAt, durationMinutes: 30 })
      .expect(201);

    const res = await api()
      .get('/api/admin/calendar')
      .query({ from: a.date, to: a.date, timezone: 'Europe/Berlin' })
      .set('Authorization', admin.auth)
      .expect(200);

    expect(res.body.bookings.length).toBeGreaterThanOrEqual(1);
    expect(res.body.providers.length).toBe(2);
    for (const booking of res.body.bookings) {
      expect(booking.localTimes.viewer.timezone).toBe('Europe/Berlin');
      // Each row still carries both parties' own clocks.
      expect(booking.localTimes.provider.timezone).toBeTruthy();
      expect(booking.localTimes.customer.timezone).toBeTruthy();
    }
  });

  it('is closed to customers', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'UTC' });
    await api()
      .get('/api/admin/calendar')
      .query({ from: date, to: date })
      .set('Authorization', customer.auth)
      .expect(403);
  });
});

// ------------------------------------------------------------ reminders ---
describe('reminder sweep', () => {
  const insertAt = async (startsAt) => {
    const { rows } = await query(
      `INSERT INTO bookings
         (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
          customer_timezone, provider_timezone)
       VALUES ($1,$2,'appointment',$3,$4,0,'Asia/Kolkata','UTC') RETURNING id`,
      [provider.id, customer.id, startsAt, addMinutes(startsAt, 30)],
    );
    return rows[0].id;
  };

  it('flags bookings inside the lead window and leaves the rest alone', async () => {
    const soon = await insertAt(addMinutes(new Date().toISOString(), 6 * 60));
    const later = await insertAt(addMinutes(new Date().toISOString(), 72 * 60));

    const result = await runReminderSweep({ leadHours: 24 });
    expect(result.flagged).toBe(1);
    expect(result.sent).toBe(1);

    const { rows } = await query(
      'SELECT id, reminder_sent_at FROM bookings WHERE id = ANY($1::uuid[])',
      [[soon, later]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.reminder_sent_at]));
    expect(byId[soon]).not.toBeNull();
    expect(byId[later]).toBeNull();
  });

  it('never reminds the same booking twice, even across concurrent sweeps', async () => {
    await insertAt(addMinutes(new Date().toISOString(), 3 * 60));

    // Two sweeps racing. SKIP LOCKED means one claims the row and the other
    // finds nothing, rather than both sending.
    const [a, b] = await Promise.all([runReminderSweep(), runReminderSweep()]);
    expect(a.flagged + b.flagged).toBe(1);

    // One reminder, but two recipients: this suite's provider has a user
    // account, and every notification goes to both parties.
    const { rows } = await query(
      `SELECT count(DISTINCT booking_id)::int AS bookings, count(*)::int AS emails
         FROM email_log WHERE template = 'booking_reminder'`,
    );
    expect(rows[0].bookings).toBe(1);
    expect(rows[0].emails).toBe(2);
  });

  it('ignores cancelled bookings', async () => {
    const id = await insertAt(addMinutes(new Date().toISOString(), 3 * 60));
    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id]);
    const result = await runReminderSweep();
    expect(result.flagged).toBe(0);
  });

  it('is exposed to admins on demand', async () => {
    await insertAt(addMinutes(new Date().toISOString(), 2 * 60));
    const res = await api()
      .post('/api/admin/reminders/run')
      .set('Authorization', admin.auth)
      .expect(200);
    expect(res.body.flagged).toBe(1);
  });
});

// ------------------------------------------------- availability editing ---
describe('availability management', () => {
  it('lets a provider replace their own weekly pattern', async () => {
    const res = await api()
      .put(`/api/providers/${provider.slug}/availability/rules`)
      .set('Authorization', providerUser.auth)
      .send({
        rules: [
          { dayOfWeek: 1, startTime: '08:00', endTime: '10:00' },
          { dayOfWeek: 3, startTime: '14:00', endTime: '16:00' },
        ],
      })
      .expect(200);
    expect(res.body.rules).toHaveLength(2);

    const { date } = futureSlot({ weekday: 3, zone: 'UTC' });
    const slots = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'UTC' });
    expect(slots.body.count).toBe(4); // 14:00-16:00 on a 30-minute grid
  });

  it('stops one provider editing another', async () => {
    const other = await createProvider({ slug: 'not-mine', timezone: 'UTC' });
    await api()
      .put(`/api/providers/${other.slug}/availability/rules`)
      .set('Authorization', providerUser.auth)
      .send({ rules: [] })
      .expect(403);
  });

  it('rejects an invalid timezone rather than storing it', async () => {
    const res = await api()
      .patch(`/api/providers/${provider.slug}`)
      .set('Authorization', admin.auth)
      .send({ timezone: 'Mars/Olympus_Mons' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a buffer change that would conflict with existing bookings', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'UTC' });
    const next = wallClockToInstant(date, timeToMinutes('10:30'), 'UTC');
    const other = await createUser({ email: 'second@test.dev' });

    await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt, durationMinutes: 30 })
      .expect(201);
    await api()
      .post('/api/bookings')
      .set('Authorization', other.auth)
      .send({ providerId: provider.id, startsAt: next, durationMinutes: 30 })
      .expect(201);

    // Those two are back-to-back. Introducing a 15-minute buffer would make
    // them overlap, so the change is refused rather than half-applied.
    const res = await api()
      .patch(`/api/providers/${provider.slug}`)
      .set('Authorization', admin.auth)
      .send({ bufferMinutes: 15 })
      .expect(409);
    expect(res.body.error.code).toBe('BUFFER_CONFLICTS_WITH_BOOKINGS');

    const { rows } = await query('SELECT buffer_minutes FROM providers WHERE id = $1', [provider.id]);
    expect(rows[0].buffer_minutes).toBe(0);
  });
});
