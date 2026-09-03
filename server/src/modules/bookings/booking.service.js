import { query, withTransaction, PG_ERRORS } from '../../db/index.js';
import {
  slotTaken,
  outsideAvailability,
  cutoffPassed,
  conflict,
  notFound,
  forbidden,
  badRequest,
} from '../../lib/errors.js';
import {
  addMinutes,
  nowInstant,
  instantToLocalDate,
  formatForZone,
  toInstant,
  shiftDate,
} from '../../lib/time.js';
import { getProviderOrFail, getRules, getExceptions } from '../providers/provider.repo.js';
import { generateSlots } from '../slots/slotEngine.js';
import { sendBookingEmail } from '../../services/email/index.js';

const BOOKING_COLUMNS = `
  b.id, b.provider_id, b.customer_id, b.kind, b.status, b.starts_at, b.ends_at,
  b.buffer_minutes, b.customer_timezone, b.provider_timezone, b.notes,
  b.cancelled_at, b.cancellation_reason, b.cutoff_overridden, b.cancelled_late,
  b.rescheduled_to, b.rescheduled_from, b.reminder_sent_at, b.created_at
`;

const BOOKING_JOIN = `
  FROM bookings b
  JOIN providers p ON p.id = b.provider_id
  LEFT JOIN users u ON u.id = b.customer_id
`;

const BOOKING_EXTRAS = `
  p.name AS provider_name, p.slug AS provider_slug, p.timezone AS provider_tz_current,
  p.cancellation_cutoff_hours,
  u.name AS customer_name, u.email AS customer_email, u.timezone AS customer_tz_current
`;

/**
 * Render a booking for one audience.
 *
 * Both the provider-local and customer-local wall clocks are always included,
 * next to the underlying UTC instant. This is the requirement about "the
 * confirmation must show the correct local time for both" made structural: a
 * client cannot render a booking time without having been handed both, so it
 * cannot accidentally show one party the other's clock.
 */
export function serializeBooking(row, viewerTimezone = null) {
  const viewerTz = viewerTimezone ?? row.customer_timezone ?? 'UTC';
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerSlug: row.provider_slug,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    notes: row.notes,

    // The canonical value. Everything below is a rendering of it.
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000),
    bufferMinutes: row.buffer_minutes,

    localTimes: {
      viewer: {
        timezone: viewerTz,
        date: instantToLocalDate(row.starts_at, viewerTz),
        label: formatForZone(row.starts_at, viewerTz),
        start: formatForZone(row.starts_at, viewerTz, { includeZone: false }),
        end: formatForZone(row.ends_at, viewerTz, { includeZone: false }),
      },
      provider: {
        timezone: row.provider_timezone,
        label: formatForZone(row.starts_at, row.provider_timezone),
      },
      customer: {
        timezone: row.customer_timezone,
        label: formatForZone(row.starts_at, row.customer_timezone),
      },
    },

    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    cancelledLate: row.cancelled_late,
    cutoffOverridden: row.cutoff_overridden,
    rescheduledTo: row.rescheduled_to,
    rescheduledFrom: row.rescheduled_from,
    reminderSentAt: row.reminder_sent_at,
    cancellationCutoffHours: row.cancellation_cutoff_hours,
    createdAt: row.created_at,
  };
}

async function loadBooking(id, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT ${BOOKING_COLUMNS}, ${BOOKING_EXTRAS} ${BOOKING_JOIN} WHERE b.id = $1`,
    [id],
  );
  if (rows.length === 0) throw notFound('Booking not found');
  return rows[0];
}

/** Customers see their own; provider users see their provider's; admins see all. */
export function assertCanViewBooking(user, booking, provider) {
  if (!user) throw forbidden();
  if (user.role === 'admin') return;
  if (booking.customer_id && booking.customer_id === user.id) return;
  if (user.role === 'provider' && provider?.user_id === user.id) return;
  throw forbidden('You do not have access to this booking');
}

/**
 * Is `startsAt` a start time this provider actually offers?
 *
 * This is a check-then-act, and that is fine: availability rules are
 * admin-edited configuration, not contended state. The thing that genuinely
 * races - whether the slot is still free - is NOT checked here at all. That is
 * left entirely to the exclusion constraint on insert.
 */
async function assertWithinAvailability(provider, startsAt, endsAt, durationMinutes) {
  const localDate = instantToLocalDate(startsAt, provider.timezone);
  const scanFrom = shiftDate(localDate, -1);
  const scanTo = shiftDate(localDate, 1);

  const [rules, exceptions] = await Promise.all([
    getRules(provider.id),
    getExceptions(provider.id, scanFrom, scanTo),
  ]);

  const offered = generateSlots({
    provider,
    rules,
    exceptions,
    busy: [], // deliberately empty - occupancy is the database's job
    fromDate: scanFrom,
    toDate: scanTo,
    durationMinutes,
    granularity: provider.slot_minutes,
    now: nowInstant(),
  });

  if (!offered.some((s) => s.startsAt === startsAt && s.endsAt === endsAt)) {
    throw outsideAvailability();
  }
}

/** Is this booking inside the provider's notice window? */
function isInsideCutoff(booking) {
  const cutoffHours = booking.cancellation_cutoff_hours ?? 0;
  if (cutoffHours <= 0) return false;
  return nowInstant() >= addMinutes(booking.starts_at, -cutoffHours * 60);
}

/**
 * Rescheduling keeps the hard rule.
 *
 * Cancelling and rescheduling are not the same act. Cancelling *informs* the
 * provider - it hands time back, and refusing it only means they hold a slot
 * nobody can use. Rescheduling *asks* them to take a different time, which is
 * exactly what short notice makes unreasonable. So the cutoff blocks the
 * second and merely records the first.
 */
function assertRescheduleCutoff(booking, actor, override) {
  if (!isInsideCutoff(booking)) return false;
  // Only an admin can push it through, and only when they explicitly ask to,
  // so an accidental admin click behaves like anyone else's.
  if (actor?.role === 'admin' && override) return true;
  throw cutoffPassed(booking.cancellation_cutoff_hours ?? 0, booking.starts_at);
}

/**
 * Serialise writers for one provider's calendar, for the life of the
 * transaction.
 *
 * This is NOT the double-booking guarantee - the exclusion constraint is, and
 * it holds whether or not this lock is taken. This exists for liveness.
 *
 * Without it, two simultaneous inserts of overlapping ranges each insert their
 * own tuple, then each scans the GiST index, finds the other's uncommitted row
 * and waits for it: a genuine cycle, which Postgres breaks by killing one with
 * SQLSTATE 40P01 (deadlock_detected) after `deadlock_timeout` (1s by default).
 * Correct - exactly one booking survives - but the loser waits a second to be
 * told "deadlock" rather than being told immediately that the slot is taken.
 *
 * With the lock, writers queue: the winner commits, the next one runs its
 * insert against a committed row and gets a clean, instant 23P01. Same
 * outcome, deterministic error, no deadlock storm under load.
 *
 * The lock is held only for the insert and released by COMMIT/ROLLBACK.
 */
async function lockProviderCalendar(client, providerId) {
  await client.query('SELECT pg_advisory_xact_lock(1, hashtext($1))', [providerId]);
}

/**
 * Retry a transaction that lost to contention rather than to a rule.
 *
 * A deadlock or serialization failure means we never found out whether the
 * slot was free - our transaction was aborted before the constraint could
 * speak. Retrying gets a real answer: either the insert succeeds because the
 * other writer rolled back, or it fails with 23P01 because they committed.
 * Only genuinely unresolvable contention reaches the caller.
 */
async function withContentionRetry(fn, { attempts = 6 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const contended =
        err.code === PG_ERRORS.DEADLOCK_DETECTED || err.code === PG_ERRORS.SERIALIZATION_FAILURE;
      if (!contended || attempt >= attempts - 1) throw err;
      // Jittered backoff so a large field of retriers does not re-collide in
      // lockstep on the next round.
      await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 25));
    }
  }
}

/** Insert a booking row. The only place `bookings` is inserted into. */
async function insertBooking(client, values) {
  try {
    const { rows } = await client.query(
      `INSERT INTO bookings
         (provider_id, customer_id, kind, starts_at, ends_at, buffer_minutes,
          customer_timezone, provider_timezone, notes, rescheduled_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        values.providerId,
        values.customerId,
        values.kind,
        values.startsAt,
        values.endsAt,
        values.bufferMinutes,
        values.customerTimezone,
        values.providerTimezone,
        values.notes ?? '',
        values.rescheduledFrom ?? null,
      ],
    );
    return rows[0].id;
  } catch (err) {
    // 23P01 is the whole point of this project. Two concurrent transactions
    // both saw a free slot; Postgres let exactly one of them commit and told
    // the other, definitively, that it lost. No retry loop, no advisory lock,
    // no application-level check that could have gone stale between read and
    // write.
    if (err.code === PG_ERRORS.EXCLUSION_VIOLATION) throw slotTaken();
    // A deadlock that survived every retry still means one thing on this
    // statement: another writer was contending for the same window. Reporting
    // it as a 409 the caller can act on beats a 500 they cannot.
    if (err.code === PG_ERRORS.DEADLOCK_DETECTED) throw slotTaken();
    throw err;
  }
}

// ---------------------------------------------------------------- create ---
export async function createBooking({
  providerIdOrSlug,
  customerId,
  startsAt: rawStart,
  durationMinutes,
  notes = '',
  actor,
  skipAvailabilityCheck = false,
}) {
  const provider = await getProviderOrFail(providerIdOrSlug);
  if (!provider.is_active && actor?.role !== 'admin') {
    throw conflict('This provider is not taking bookings', 'PROVIDER_INACTIVE');
  }

  const startsAt = toInstant(rawStart);
  const duration = durationMinutes ?? provider.slot_minutes;
  const endsAt = addMinutes(startsAt, duration);

  const { rows: customerRows } = await query(
    'SELECT id, name, email, timezone FROM users WHERE id = $1',
    [customerId],
  );
  if (customerRows.length === 0) throw badRequest('Customer not found');
  const customer = customerRows[0];

  // Admins can place a booking outside published hours (fitting someone in);
  // they still cannot place one on top of another, because that check is not
  // theirs to skip.
  if (!(skipAvailabilityCheck && actor?.role === 'admin')) {
    await assertWithinAvailability(provider, startsAt, endsAt, duration);
  }

  const id = await withContentionRetry(() =>
    withTransaction(async (client) => {
      await lockProviderCalendar(client, provider.id);
      return insertBooking(client, {
      providerId: provider.id,
      customerId: customer.id,
      kind: 'appointment',
      startsAt,
      endsAt,
      bufferMinutes: provider.buffer_minutes,
      customerTimezone: customer.timezone,
      providerTimezone: provider.timezone,
      notes,
      });
    }),
  );

  const booking = await loadBooking(id);
  await sendBookingEmail('booking_confirmed', booking);
  return booking;
}

// ---------------------------------------------------------------- cancel ---
export async function cancelBooking({ bookingId, actor, reason = '' }) {
  const booking = await loadBooking(bookingId);
  const provider = await getProviderOrFail(booking.provider_id);
  assertCanViewBooking(actor, booking, provider);

  if (booking.status === 'cancelled') {
    throw conflict('This booking is already cancelled', 'ALREADY_CANCELLED');
  }
  if (booking.status === 'completed') {
    throw conflict('Completed bookings cannot be cancelled', 'ALREADY_COMPLETED');
  }

  // A cancellation is never refused. Inside the notice window it is recorded
  // as late so the provider's email says so and any fee policy has something
  // to act on, but the slot is still handed back either way.
  const late = isInsideCutoff(booking);

  // Flipping status out of 'confirmed' drops the row from the partial
  // exclusion index, so the slot is bookable again the moment this commits.
  // There is no separate "release" step that could be missed.
  await query(
    `UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by = $2,
            cancellation_reason = $3,
            cancelled_late = $4
      WHERE id = $1 AND status = 'confirmed'`,
    [bookingId, actor?.id ?? null, reason, late],
  );

  const updated = await loadBooking(bookingId);
  await sendBookingEmail('booking_cancelled', updated);
  return updated;
}

// ------------------------------------------------------------ reschedule ---
export async function rescheduleBooking({
  bookingId,
  startsAt: rawStart,
  durationMinutes,
  actor,
  override = false,
  skipAvailabilityCheck = false,
}) {
  const original = await loadBooking(bookingId);
  const provider = await getProviderOrFail(original.provider_id);
  assertCanViewBooking(actor, original, provider);

  if (original.status !== 'confirmed') {
    throw conflict('Only a confirmed booking can be rescheduled', 'NOT_CONFIRMED');
  }
  if (original.kind !== 'appointment') {
    throw conflict('Blocks are moved by deleting and recreating them', 'NOT_AN_APPOINTMENT');
  }

  const startsAt = toInstant(rawStart);
  const duration =
    durationMinutes ??
    Math.round((Date.parse(original.ends_at) - Date.parse(original.starts_at)) / 60000);
  const endsAt = addMinutes(startsAt, duration);

  if (startsAt === original.starts_at && endsAt === original.ends_at) {
    throw badRequest('That is already the booking time');
  }

  // The cutoff applies to the time being moved away from: a booking starting
  // in an hour cannot be shifted onto the provider at that notice, even though
  // it can still be cancelled outright.
  const overridden = assertRescheduleCutoff(original, actor, override);

  if (!(skipAvailabilityCheck && actor?.role === 'admin')) {
    await assertWithinAvailability(provider, startsAt, endsAt, duration);
  }

  const newId = await withContentionRetry(() =>
    withTransaction(async (client) => {
    await lockProviderCalendar(client, provider.id);
    // Release first, then take. Both statements are in one transaction, so:
    //  - the old slot is genuinely free for the new row (a small shift like
    //    10:00 -> 10:15 does not collide with itself), and
    //  - if the new slot loses a race, the ROLLBACK puts the original booking
    //    back exactly as it was. A reschedule can never destroy a booking by
    //    failing halfway.
    await client.query(
      `UPDATE bookings
          SET status = 'cancelled',
              cancelled_at = now(),
              cancelled_by = $2,
              cancellation_reason = 'Rescheduled',
              cutoff_overridden = $3
        WHERE id = $1 AND status = 'confirmed'`,
      [bookingId, actor?.id ?? null, overridden],
    );

    const id = await insertBooking(client, {
      providerId: provider.id,
      customerId: original.customer_id,
      kind: 'appointment',
      startsAt,
      endsAt,
      bufferMinutes: provider.buffer_minutes,
      customerTimezone: original.customer_timezone,
      providerTimezone: provider.timezone,
      notes: original.notes,
      rescheduledFrom: bookingId,
    });

    await client.query('UPDATE bookings SET rescheduled_to = $2 WHERE id = $1', [bookingId, id]);
    return id;
    }),
  );

  const created = await loadBooking(newId);
  await sendBookingEmail('booking_rescheduled', created, { previous: original });
  return created;
}

// ------------------------------------------------------------ admin block ---
export async function createBlock({ providerIdOrSlug, startsAt: rawStart, endsAt: rawEnd, notes = '' }) {
  const provider = await getProviderOrFail(providerIdOrSlug);
  const startsAt = toInstant(rawStart);
  const endsAt = toInstant(rawEnd);
  if (endsAt <= startsAt) throw badRequest('Block must end after it starts');

  // Blocks carry no buffer: an admin blocking 13:00-14:00 means exactly that.
  const id = await withContentionRetry(() =>
    withTransaction(async (client) => {
      await lockProviderCalendar(client, provider.id);
      return insertBooking(client, {
      providerId: provider.id,
      customerId: null,
      kind: 'block',
      startsAt,
      endsAt,
      bufferMinutes: 0,
      customerTimezone: provider.timezone,
      providerTimezone: provider.timezone,
      notes,
      });
    }),
  );
  return loadBooking(id);
}

// ---------------------------------------------------------------- queries ---
export async function listBookings({
  customerId,
  providerId,
  status,
  kind,
  fromInstant,
  toInstant: toInst,
  limit = 200,
}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('$?', `$${params.length}`));
  };

  if (customerId) add('b.customer_id = $?', customerId);
  if (providerId) add('b.provider_id = $?', providerId);
  if (status) add('b.status = $?::booking_status', status);
  if (kind) add('b.kind = $?::booking_kind', kind);
  if (fromInstant) add('b.ends_at > $?::timestamptz', fromInstant);
  if (toInst) add('b.starts_at < $?::timestamptz', toInst);

  params.push(limit);
  const { rows } = await query(
    `SELECT ${BOOKING_COLUMNS}, ${BOOKING_EXTRAS} ${BOOKING_JOIN}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY b.starts_at
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export { loadBooking };
