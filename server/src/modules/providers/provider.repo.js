import { query } from '../../db/index.js';
import { notFound, forbidden } from '../../lib/errors.js';
import { minutesToTime } from '../../lib/time.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const serializeProvider = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  timezone: row.timezone,
  bufferMinutes: row.buffer_minutes,
  slotMinutes: row.slot_minutes,
  minNoticeMinutes: row.min_notice_minutes,
  bookingHorizonDays: row.booking_horizon_days,
  cancellationCutoffHours: row.cancellation_cutoff_hours,
  isActive: row.is_active,
  userId: row.user_id,
});

export const serializeRule = (row) => ({
  id: row.id,
  dayOfWeek: row.day_of_week,
  startTime: minutesToTime(row.start_minute),
  endTime: minutesToTime(row.end_minute),
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
});

export const serializeException = (row) => ({
  id: row.id,
  date: row.exception_date,
  kind: row.kind,
  startTime: row.start_minute === null ? null : minutesToTime(row.start_minute),
  endTime: row.end_minute === null ? null : minutesToTime(row.end_minute),
  note: row.note,
});

/** Look a provider up by uuid or by slug, whichever the caller supplied. */
export async function findProvider(idOrSlug) {
  const sql = UUID_RE.test(idOrSlug)
    ? 'SELECT * FROM providers WHERE id = $1'
    : 'SELECT * FROM providers WHERE lower(slug) = lower($1)';
  const { rows } = await query(sql, [idOrSlug]);
  return rows[0] ?? null;
}

export async function getProviderOrFail(idOrSlug) {
  const row = await findProvider(idOrSlug);
  if (!row) throw notFound('Provider not found');
  return row;
}

/**
 * Admins manage every provider; a provider user manages only their own.
 * Customers manage none.
 */
export function assertCanManageProvider(user, provider) {
  if (!user) throw forbidden();
  if (user.role === 'admin') return;
  if (user.role === 'provider' && provider.user_id === user.id) return;
  throw forbidden('You can only manage your own provider profile');
}

export async function getRules(providerId) {
  const { rows } = await query(
    `SELECT * FROM availability_rules
      WHERE provider_id = $1
      ORDER BY day_of_week, start_minute`,
    [providerId],
  );
  return rows;
}

/**
 * Exceptions in a local-date window. Padded by the caller rather than here so
 * the padding rule lives next to the slot query that needs it.
 */
export async function getExceptions(providerId, fromDate, toDate) {
  const { rows } = await query(
    `SELECT * FROM availability_exceptions
      WHERE provider_id = $1
        AND exception_date BETWEEN $2::date AND $3::date
      ORDER BY exception_date`,
    [providerId, fromDate, toDate],
  );
  return rows;
}

/**
 * Confirmed bookings and admin blocks overlapping an instant window.
 * `reserved_range` is widened by the query rather than the caller so we never
 * miss a long appointment that started before the window opened.
 */
export async function getConfirmedBookings(providerId, fromInstant, toInstant) {
  const { rows } = await query(
    `SELECT id, provider_id, customer_id, kind, status, starts_at, ends_at, buffer_minutes
       FROM bookings
      WHERE provider_id = $1
        AND status = 'confirmed'
        AND reserved_range && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      ORDER BY starts_at`,
    [providerId, fromInstant, toInstant],
  );
  return rows;
}
