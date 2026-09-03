import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { query, getPool } from '../src/db/index.js';
import { migrateUp } from '../src/db/migrate.js';
import { timeToMinutes, wallClockToInstant, instantToLocalDate, shiftDate } from '../src/lib/time.js';
import { issueToken } from '../src/modules/auth/auth.routes.js';

export const app = createApp();
export const api = () => request(app);

let schemaReady = false;

/** Migrate once per run, then truncate between tests. */
export async function resetDatabase() {
  if (!schemaReady) {
    await migrateUp({ silent: true });
    schemaReady = true;
  }
  await query(
    'TRUNCATE email_log, bookings, availability_exceptions, availability_rules, providers, users CASCADE',
  );
}

export async function createUser({
  email,
  name = 'Test User',
  role = 'customer',
  timezone = 'UTC',
  password = 'password123',
}) {
  const hash = await bcrypt.hash(password, 4); // cheap rounds: these are throwaway
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, name, role, timezone)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [email, hash, name, role, timezone],
  );
  const user = rows[0];
  return { ...user, token: issueToken(user), auth: `Bearer ${issueToken(user)}` };
}

export async function createProvider({
  name = 'Test Provider',
  slug = 'test-provider',
  timezone = 'UTC',
  bufferMinutes = 0,
  slotMinutes = 30,
  minNoticeMinutes = 0,
  bookingHorizonDays = 365,
  cancellationCutoffHours = 24,
  userId = null,
  // Default: every weekday 09:00-17:00 provider-local.
  rules = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })),
} = {}) {
  const { rows } = await query(
    `INSERT INTO providers
       (user_id, name, slug, timezone, buffer_minutes, slot_minutes,
        min_notice_minutes, booking_horizon_days, cancellation_cutoff_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      userId,
      name,
      slug,
      timezone,
      bufferMinutes,
      slotMinutes,
      minNoticeMinutes,
      bookingHorizonDays,
      cancellationCutoffHours,
    ],
  );
  const provider = rows[0];
  for (const r of rules) {
    await query(
      `INSERT INTO availability_rules (provider_id, day_of_week, start_minute, end_minute)
       VALUES ($1,$2,$3,$4)`,
      [provider.id, r.dayOfWeek, timeToMinutes(r.start), timeToMinutes(r.end)],
    );
  }
  return provider;
}

/**
 * A date safely in the future that lands on the given ISO weekday in `zone`.
 * Tests must not depend on what day it happens to be when they run.
 */
export function nextWeekdayDate(isoWeekday, zone = 'UTC', minDaysAhead = 7) {
  let date = shiftDate(instantToLocalDate(new Date().toISOString(), zone), minDaysAhead);
  for (let i = 0; i < 8; i += 1) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    if (weekday === isoWeekday) return date;
    date = shiftDate(date, 1);
  }
  throw new Error('could not find weekday');
}

/** A future instant on the given weekday at a provider-local wall clock time. */
export function futureSlot({ weekday = 3, time = '10:00', zone = 'UTC' } = {}) {
  const date = nextWeekdayDate(weekday, zone);
  return { date, startsAt: wallClockToInstant(date, timeToMinutes(time), zone) };
}

export async function emailsFor(bookingId) {
  const { rows } = await query(
    'SELECT * FROM email_log WHERE booking_id = $1 ORDER BY created_at',
    [bookingId],
  );
  return rows;
}

export { getPool };
