import { DateTime } from 'luxon';

/**
 * Client-side rendering of instants.
 *
 * The server hands back UTC instants and never a pre-formatted local string
 * without also naming the zone. This module is the only place the browser
 * turns one into text, and every function here takes an explicit zone - there
 * is no "format in local time" helper, because "local" is the ambiguity this
 * whole app exists to remove.
 */

export const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * A curated shortlist, plus any zones the caller names.
 *
 * This deliberately does NOT call browserTimezone() itself. Doing so made the
 * <option> list depend on the runtime: during SSR it picked up the Node
 * process's zone, on the client the browser's, and the two lists then failed
 * to hydrate. Callers pass the zones they care about, so the list is a pure
 * function of its arguments.
 */
export function timezoneOptions(extra = []) {
  const common = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Athens',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
  return [...new Set([...extra.filter(Boolean), ...common])];
}

export const clock = (instant, zone) =>
  DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).toFormat('HH:mm');

export const dayLabel = (instant, zone) =>
  DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).toFormat('ccc d LLL');

export const longLabel = (instant, zone) =>
  DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).toFormat('cccc d LLLL yyyy, HH:mm');

export const localDate = (instant, zone) =>
  DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).toISODate();

/** 'UTC+02' - used as the recurring structural label instead of a decorative number. */
export function offsetLabel(zone, at = undefined) {
  const dt = at ? DateTime.fromISO(at, { zone: 'utc' }).setZone(zone) : DateTime.now().setZone(zone);
  const mins = dt.offset;
  const sign = mins < 0 ? '−' : '+';
  const abs = Math.abs(mins);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Short name for a zone: 'Los_Angeles' -> 'Los Angeles'. */
export const zoneCity = (zone) => (zone ?? '').split('/').pop().replace(/_/g, ' ');

/** Difference in hours between two zones at a given instant, e.g. '+9h'. */
export function zoneGap(a, b, at = undefined) {
  const base = at ? DateTime.fromISO(at, { zone: 'utc' }) : DateTime.utc();
  const diff = (base.setZone(a).offset - base.setZone(b).offset) / 60;
  if (diff === 0) return 'same time';
  const rounded = Math.round(diff * 10) / 10;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}h`;
}

export const today = (zone) => DateTime.now().setZone(zone).toISODate();
export const shift = (isoDate, days) =>
  DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days }).toISODate();

export function weekFrom(isoDate, length = 7) {
  const start = DateTime.fromISO(isoDate, { zone: 'utc' });
  return Array.from({ length }, (_, i) => {
    const d = start.plus({ days: i });
    return { date: d.toISODate(), weekday: d.toFormat('ccc'), day: d.toFormat('d'), month: d.toFormat('LLL') };
  });
}

export const relative = (instant) =>
  DateTime.fromISO(instant, { zone: 'utc' }).toRelative({ base: DateTime.utc() });

export const isPast = (instant) => Date.parse(instant) < Date.now();
