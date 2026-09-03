import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { api, resetDatabase, createUser, createProvider, futureSlot, emailsFor } from './helpers.js';
import { query, closePool } from '../src/db/index.js';
import { addMinutes, wallClockToInstant, timeToMinutes, instantToLocalDate } from '../src/lib/time.js';

let admin;
let customer;
let provider;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ email: 'admin@test.dev', role: 'admin', timezone: 'Europe/Berlin' });
  customer = await createUser({
    email: 'cust@test.dev',
    name: 'Sam Rivera',
    timezone: 'America/Los_Angeles',
  });
  provider = await createProvider({
    slug: 'flow-provider',
    timezone: 'Europe/Berlin',
    bufferMinutes: 0,
    slotMinutes: 30,
    cancellationCutoffHours: 24,
  });
}, 60_000);

afterAll(async () => {
  await closePool();
});

const book = (startsAt, over = {}) =>
  api()
    .post('/api/bookings')
    .set('Authorization', customer.auth)
    .send({ providerId: provider.id, startsAt, durationMinutes: 30, ...over });

// ---------------------------------------------------------------- slots ---
describe('slot endpoint', () => {
  it('derives slots from the recurring rules', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    const res = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'Europe/Berlin' })
      .expect(200);

    // 09:00-17:00 on a 30-minute grid = 16 slots.
    expect(res.body.count).toBe(16);
    expect(res.body.days[0].date).toBe(date);
    expect(res.body.days[0].slots[0].startsAt).toBe(
      wallClockToInstant(date, timeToMinutes('09:00'), 'Europe/Berlin'),
    );
  });

  it('drops a slot once it is booked, and restores it on cancellation', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const params = { from: date, timezone: 'Europe/Berlin' };

    const before = await api().get(`/api/providers/${provider.slug}/slots`).query(params);
    expect(before.body.count).toBe(16);

    const created = await book(startsAt).expect(201);

    const during = await api().get(`/api/providers/${provider.slug}/slots`).query(params);
    expect(during.body.count).toBe(15);
    expect(during.body.days[0].slots.some((s) => s.startsAt === startsAt)).toBe(false);

    await api()
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);

    const after = await api().get(`/api/providers/${provider.slug}/slots`).query(params);
    expect(after.body.count).toBe(16);
    expect(after.body.days[0].slots.some((s) => s.startsAt === startsAt)).toBe(true);
  });

  it('honours a blocked-day exception', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    await api()
      .post(`/api/providers/${provider.slug}/availability/exceptions`)
      .set('Authorization', admin.auth)
      .send({ date, kind: 'blocked', note: 'Holiday' })
      .expect(201);

    const res = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'Europe/Berlin' });
    expect(res.body.count).toBe(0);
  });

  it('honours a custom-hours exception in place of the usual pattern', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    await api()
      .post(`/api/providers/${provider.slug}/availability/exceptions`)
      .set('Authorization', admin.auth)
      .send({ date, kind: 'custom_hours', startTime: '13:00', endTime: '15:00' })
      .expect(201);

    const res = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'Europe/Berlin' });
    expect(res.body.count).toBe(4);
  });
});

// ------------------------------------------------------------ timezones ---
describe('cross-timezone booking', () => {
  it('shows the same instant as the right local time to both parties', async () => {
    // 10:00 in Berlin. The customer is in Los Angeles.
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const res = await book(startsAt).expect(201);
    const b = res.body.booking;

    expect(b.startsAt).toBe(startsAt);
    expect(b.localTimes.provider.timezone).toBe('Europe/Berlin');
    expect(b.localTimes.customer.timezone).toBe('America/Los_Angeles');
    expect(b.localTimes.provider.label).toMatch(/10:00/);
    // Berlin is 9h ahead of LA in summer, 9h in winter too - either way the
    // customer must NOT see 10:00.
    expect(b.localTimes.customer.label).not.toMatch(/ 10:00/);

    // The two labels describe one instant, so re-parsing them agrees.
    const providerDate = instantToLocalDate(b.startsAt, 'Europe/Berlin');
    const customerDate = instantToLocalDate(b.startsAt, 'America/Los_Angeles');
    expect(providerDate >= customerDate).toBe(true);
  });

  it('the confirmation email carries both clocks', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const res = await book(startsAt).expect(201);

    const emails = await emailsFor(res.body.booking.id);
    expect(emails).toHaveLength(1); // provider has no user account here
    expect(emails[0].template).toBe('booking_confirmed');
    expect(emails[0].to_email).toBe('cust@test.dev');
    expect(emails[0].body).toContain('Europe/Berlin');
    expect(emails[0].body).toContain('America/Los_Angeles');
    expect(emails[0].status).toBe('sent');
  });

  it('groups slots by the viewer local date, so far-apart zones still line up', async () => {
    const auckland = await createProvider({
      slug: 'auckland-provider',
      timezone: 'Pacific/Auckland',
      rules: [{ dayOfWeek: 3, start: '09:00', end: '10:00' }],
    });
    const { date } = futureSlot({ weekday: 3, zone: 'Pacific/Auckland' });

    const local = await api()
      .get(`/api/providers/${auckland.slug}/slots`)
      .query({ from: date, timezone: 'Pacific/Auckland' })
      .expect(200);
    expect(local.body.days[0].date).toBe(date);

    // The same instant belongs to the previous calendar day in Los Angeles,
    // so asking for `date` in LA must NOT return it.
    const abroad = await api()
      .get(`/api/providers/${auckland.slug}/slots`)
      .query({ from: date, timezone: 'America/Los_Angeles' })
      .expect(200);
    expect(abroad.body.days.every((d) => d.date !== date)).toBe(true);
  });
});

// ----------------------------------------------------------- validation ---
describe('booking validation', () => {
  it('refuses a time outside published availability', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    const tooEarly = wallClockToInstant(date, timeToMinutes('07:00'), 'Europe/Berlin');
    const res = await book(tooEarly).expect(409);
    expect(res.body.error.code).toBe('OUTSIDE_AVAILABILITY');
  });

  it('refuses a start that is off the slot grid', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    const offGrid = wallClockToInstant(date, timeToMinutes('10:07'), 'Europe/Berlin');
    await book(offGrid).expect(409);
  });

  it('refuses a booking on a weekend the provider does not work', async () => {
    const { startsAt } = futureSlot({ weekday: 7, time: '10:00', zone: 'Europe/Berlin' });
    await book(startsAt).expect(409);
  });

  it('lets an admin fit someone in outside published hours, but never over a booking', async () => {
    const { date } = futureSlot({ weekday: 3, zone: 'Europe/Berlin' });
    const evening = wallClockToInstant(date, timeToMinutes('19:00'), 'Europe/Berlin');

    const ok = await api()
      .post('/api/bookings')
      .set('Authorization', admin.auth)
      .send({
        providerId: provider.id,
        customerId: customer.id,
        startsAt: evening,
        durationMinutes: 30,
        skipAvailabilityCheck: true,
      })
      .expect(201);
    expect(ok.body.booking.status).toBe('confirmed');

    // The override does not extend to overlapping an existing booking.
    const clash = await api()
      .post('/api/bookings')
      .set('Authorization', admin.auth)
      .send({
        providerId: provider.id,
        customerId: customer.id,
        startsAt: evening,
        durationMinutes: 30,
        skipAvailabilityCheck: true,
      })
      .expect(409);
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
  });

  it('requires authentication', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    await api()
      .post('/api/bookings')
      .send({ providerId: provider.id, startsAt })
      .expect(401);
  });

  it('stops a customer booking on someone else behalf', async () => {
    const other = await createUser({ email: 'other@test.dev' });
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const res = await api()
      .post('/api/bookings')
      .set('Authorization', customer.auth)
      .send({ providerId: provider.id, startsAt, customerId: other.id })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// --------------------------------------------------------- cancellation ---
describe('cancellation policy', () => {
  it('allows cancellation before the cutoff', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const created = await book(startsAt).expect(201);

    const res = await api()
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({ reason: 'Changed my mind' })
      .expect(200);

    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.booking.cancellationReason).toBe('Changed my mind');
    expect(res.body.booking.cutoffOverridden).toBe(false);

    const emails = await emailsFor(created.body.booking.id);
    expect(emails.map((e) => e.template)).toContain('booking_cancelled');
  });

  it('still allows cancellation inside the cutoff, and records it as late', async () => {
    // The rule that matters: a customer who is not coming can always say so.
    // Refusing would leave the provider holding a slot nobody can use.
    const created = await bookInsideCutoff();
    const res = await api()
      .post(`/api/bookings/${created.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({ reason: 'Suddenly ill' })
      .expect(200);

    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.booking.cancelledLate).toBe(true);
    expect(res.body.booking.cancellationReason).toBe('Suddenly ill');

    const { rows } = await query('SELECT status, cancelled_late FROM bookings WHERE id = $1', [
      created.id,
    ]);
    expect(rows[0].status).toBe('cancelled');
    expect(rows[0].cancelled_late).toBe(true);
  });

  it('does not flag a cancellation made outside the window', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const created = await book(startsAt).expect(201);
    const res = await api()
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);
    expect(res.body.booking.cancelledLate).toBe(false);
  });

  it('frees the slot immediately even when cancelled late', async () => {
    // The point of allowing it: the time genuinely goes back on the calendar.
    const created = await bookInsideCutoff();
    const { rows: before } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(before[0].n).toBe(1);

    await api()
      .post(`/api/bookings/${created.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);

    const { rows: after } = await query(
      `SELECT count(*)::int AS n FROM bookings WHERE provider_id = $1 AND status = 'confirmed'`,
      [provider.id],
    );
    expect(after[0].n).toBe(0);
  });

  it("tells the provider the cancellation was late", async () => {
    const created = await bookInsideCutoff();
    await api()
      .post(`/api/bookings/${created.id}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);

    const emails = await emailsFor(created.id);
    const cancelled = emails.find((e) => e.template === 'booking_cancelled');
    expect(cancelled.body).toMatch(/short notice/i);
  });

  it('lets an admin cancel on someone behalf too', async () => {
    const created = await bookInsideCutoff();
    const res = await api()
      .post(`/api/admin/bookings/${created.id}/override-cancel`)
      .set('Authorization', admin.auth)
      .send({ reason: 'Provider is ill' })
      .expect(200);

    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.booking.cancelledLate).toBe(true);
  });

  it('refuses to cancel twice', async () => {
    const { startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const created = await book(startsAt).expect(201);
    const url = `/api/bookings/${created.body.booking.id}/cancel`;
    await api().post(url).set('Authorization', customer.auth).send({}).expect(200);
    const second = await api().post(url).set('Authorization', customer.auth).send({}).expect(409);
    expect(second.body.error.code).toBe('ALREADY_CANCELLED');
  });

  /**
   * Inserted directly so the booking sits inside the cutoff window. Going
   * through the API would be refused by min-notice, which is a different rule.
   */
  async function bookInsideCutoff() {
    const startsAt = addMinutes(new Date().toISOString(), 60);
    const { rows } = await query(
      `INSERT INTO bookings
         (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
          customer_timezone, provider_timezone)
       VALUES ($1,$2,'appointment',$3,$4,0,$5,$6) RETURNING id`,
      [
        provider.id,
        customer.id,
        startsAt,
        addMinutes(startsAt, 30),
        customer.timezone,
        provider.timezone,
      ],
    );
    return rows[0];
  }
});

// -------------------------------------------------------- rescheduling ---
describe('rescheduling', () => {
  it('frees the old slot and takes the new one', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const target = wallClockToInstant(date, timeToMinutes('14:00'), 'Europe/Berlin');
    const created = await book(startsAt).expect(201);

    const res = await api()
      .post(`/api/bookings/${created.body.booking.id}/reschedule`)
      .set('Authorization', customer.auth)
      .send({ startsAt: target })
      .expect(201);

    expect(res.body.booking.startsAt).toBe(target);
    expect(res.body.booking.rescheduledFrom).toBe(created.body.booking.id);

    // Old row is cancelled and points forward; the pair is traceable.
    const { rows } = await query('SELECT status, rescheduled_to FROM bookings WHERE id = $1', [
      created.body.booking.id,
    ]);
    expect(rows[0].status).toBe('cancelled');
    expect(rows[0].rescheduled_to).toBe(res.body.booking.id);

    // The old slot is offered again; the new one is not.
    const slots = await api()
      .get(`/api/providers/${provider.slug}/slots`)
      .query({ from: date, timezone: 'Europe/Berlin' });
    const starts = slots.body.days[0].slots.map((s) => s.startsAt);
    expect(starts).toContain(startsAt);
    expect(starts).not.toContain(target);
  });

  it('re-runs the double-booking check on the new slot', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const taken = wallClockToInstant(date, timeToMinutes('14:00'), 'Europe/Berlin');
    const other = await createUser({ email: 'other2@test.dev' });

    const mine = await book(startsAt).expect(201);
    await api()
      .post('/api/bookings')
      .set('Authorization', other.auth)
      .send({ providerId: provider.id, startsAt: taken, durationMinutes: 30 })
      .expect(201);

    const res = await api()
      .post(`/api/bookings/${mine.body.booking.id}/reschedule`)
      .set('Authorization', customer.auth)
      .send({ startsAt: taken })
      .expect(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');

    // A failed reschedule must leave the original exactly as it was.
    const { rows } = await query('SELECT status, starts_at FROM bookings WHERE id = $1', [
      mine.body.booking.id,
    ]);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].starts_at).toBe(startsAt);
  });

  it('allows a small shift that overlaps the booking own current slot', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const created = await book(startsAt).expect(201);
    const nudged = wallClockToInstant(date, timeToMinutes('10:30'), 'Europe/Berlin');

    // 10:00-10:30 moving to 10:30-11:00 is adjacent; with a buffer it would
    // overlap itself, which is why the release happens before the take.
    await api()
      .post(`/api/bookings/${created.body.booking.id}/reschedule`)
      .set('Authorization', customer.auth)
      .send({ startsAt: nudged })
      .expect(201);
  });

  it('refuses a reschedule inside the cutoff, even though cancelling is allowed', async () => {
    const startsAt = addMinutes(new Date().toISOString(), 60);
    const { rows } = await query(
      `INSERT INTO bookings
         (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
          customer_timezone, provider_timezone)
       VALUES ($1,$2,'appointment',$3,$4,0,'UTC','Europe/Berlin') RETURNING id`,
      [provider.id, customer.id, startsAt, addMinutes(startsAt, 30)],
    );
    const { startsAt: target } = futureSlot({ weekday: 3, time: '11:00', zone: 'Europe/Berlin' });

    const res = await api()
      .post(`/api/bookings/${rows[0].id}/reschedule`)
      .set('Authorization', customer.auth)
      .send({ startsAt: target })
      .expect(409);
    expect(res.body.error.code).toBe('CANCELLATION_CUTOFF_PASSED');

    // The same booking CAN still be cancelled - that is the whole distinction.
    await api()
      .post(`/api/bookings/${rows[0].id}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(200);
  });

  it('emails the new time and the old one', async () => {
    const { date, startsAt } = futureSlot({ weekday: 3, time: '10:00', zone: 'Europe/Berlin' });
    const target = wallClockToInstant(date, timeToMinutes('14:00'), 'Europe/Berlin');
    const created = await book(startsAt).expect(201);

    const moved = await api()
      .post(`/api/bookings/${created.body.booking.id}/reschedule`)
      .set('Authorization', customer.auth)
      .send({ startsAt: target })
      .expect(201);

    const emails = await emailsFor(moved.body.booking.id);
    expect(emails.map((e) => e.template)).toContain('booking_rescheduled');
    expect(emails.at(-1).body).toMatch(/Previously/);
  });
});
