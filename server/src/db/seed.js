#!/usr/bin/env node
/**
 * Demo data. Deliberately spans three continents, because a booking system
 * that has only ever been seeded with one timezone will look correct right up
 * until someone in another one uses it.
 */
import bcrypt from 'bcryptjs';
import { query, closePool } from './index.js';
import { timeToMinutes, shiftDate, instantToLocalDate, nowInstant } from '../lib/time.js';

const PASSWORD = 'password123';

const USERS = [
  { email: 'admin@booking.test', name: 'Ada Admin', role: 'admin', timezone: 'Europe/Berlin' },
  { email: 'nadia@booking.test', name: 'Dr Nadia Okonkwo', role: 'provider', timezone: 'Europe/Berlin' },
  { email: 'kenji@booking.test', name: 'Kenji Tanaka', role: 'provider', timezone: 'Asia/Tokyo' },
  { email: 'sam@booking.test', name: 'Sam Rivera', role: 'customer', timezone: 'America/Los_Angeles' },
  { email: 'priya@booking.test', name: 'Priya Nair', role: 'customer', timezone: 'Asia/Kolkata' },
];

const PROVIDERS = [
  {
    owner: 'nadia@booking.test',
    name: 'Dr Nadia Okonkwo - Consultations',
    slug: 'nadia-consults',
    description: 'General consultations, 30 minutes, with a 15 minute gap between appointments.',
    timezone: 'Europe/Berlin',
    bufferMinutes: 15,
    slotMinutes: 30,
    minNoticeMinutes: 120,
    bookingHorizonDays: 45,
    cancellationCutoffHours: 24,
    // Mon-Fri 09:00-12:30 and 13:30-17:00, Berlin time.
    rules: [
      ...[1, 2, 3, 4, 5].flatMap((d) => [
        { dayOfWeek: d, start: '09:00', end: '12:30' },
        { dayOfWeek: d, start: '13:30', end: '17:00' },
      ]),
    ],
  },
  {
    owner: 'kenji@booking.test',
    name: 'Kenji Tanaka - Studio Sessions',
    slug: 'kenji-studio',
    description: 'One-hour studio sessions in Tokyo. Saturdays included.',
    timezone: 'Asia/Tokyo',
    bufferMinutes: 0,
    slotMinutes: 60,
    minNoticeMinutes: 60,
    bookingHorizonDays: 60,
    cancellationCutoffHours: 48,
    rules: [
      ...[2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '13:00', end: '20:00' })),
      { dayOfWeek: 6, start: '10:00', end: '16:00' },
    ],
  },
  {
    owner: null,
    name: 'Meeting Room A',
    slug: 'meeting-room-a',
    description: 'Bookable resource, no human attached. Open around the clock on weekdays.',
    timezone: 'UTC',
    bufferMinutes: 0,
    slotMinutes: 30,
    minNoticeMinutes: 0,
    bookingHorizonDays: 30,
    cancellationCutoffHours: 1,
    rules: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '00:00', end: '24:00' })),
  },
];

async function seed() {
  console.log('[seed] clearing existing data');
  await query('TRUNCATE email_log, bookings, availability_exceptions, availability_rules, providers, users CASCADE');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const userIds = new Map();

  for (const u of USERS) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, role, timezone)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [u.email, passwordHash, u.name, u.role, u.timezone],
    );
    userIds.set(u.email, rows[0].id);
  }
  console.log(`[seed] ${USERS.length} users`);

  const providerIds = new Map();
  for (const p of PROVIDERS) {
    const { rows } = await query(
      `INSERT INTO providers
         (user_id, name, slug, description, timezone, buffer_minutes, slot_minutes,
          min_notice_minutes, booking_horizon_days, cancellation_cutoff_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        p.owner ? userIds.get(p.owner) : null,
        p.name,
        p.slug,
        p.description,
        p.timezone,
        p.bufferMinutes,
        p.slotMinutes,
        p.minNoticeMinutes,
        p.bookingHorizonDays,
        p.cancellationCutoffHours,
      ],
    );
    const providerId = rows[0].id;
    providerIds.set(p.slug, providerId);

    for (const r of p.rules) {
      await query(
        `INSERT INTO availability_rules (provider_id, day_of_week, start_minute, end_minute)
         VALUES ($1,$2,$3,$4)`,
        [providerId, r.dayOfWeek, timeToMinutes(r.start), timeToMinutes(r.end)],
      );
    }
  }
  console.log(`[seed] ${PROVIDERS.length} providers with availability`);

  // A holiday and a short day for Nadia, relative to today so the demo data
  // never goes stale.
  const today = instantToLocalDate(nowInstant(), 'Europe/Berlin');
  const nadia = providerIds.get('nadia-consults');
  await query(
    `INSERT INTO availability_exceptions (provider_id, exception_date, kind, note)
     VALUES ($1, $2, 'blocked', 'Public holiday')`,
    [nadia, shiftDate(today, 9)],
  );
  await query(
    `INSERT INTO availability_exceptions
       (provider_id, exception_date, kind, start_minute, end_minute, note)
     VALUES ($1, $2, 'custom_hours', $3, $4, 'Half day - conference in the afternoon')`,
    [nadia, shiftDate(today, 10), timeToMinutes('09:00'), timeToMinutes('12:00')],
  );
  console.log('[seed] 2 availability exceptions');

  console.log('\nAccounts (password for all: %s)', PASSWORD);
  for (const u of USERS) console.log(`  ${u.role.padEnd(9)} ${u.email.padEnd(24)} ${u.timezone}`);
  console.log('\nProviders:');
  for (const p of PROVIDERS) console.log(`  /${p.slug.padEnd(16)} ${p.timezone}`);
}

try {
  await seed();
} catch (err) {
  console.error('[seed]', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
