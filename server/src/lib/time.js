import { DateTime, IANAZone, Interval } from 'luxon';

/**
 * The canonical instant format for the whole codebase: ISO-8601, UTC, always
 * with milliseconds and a trailing Z. Everything - Luxon output, values read
 * back from Postgres, values arriving over HTTP - is funnelled through here.
 *
 * This is not cosmetic. Instants are compared and sorted as plain strings in
 * the slot engine, and '...:00Z' and '...:00.000Z' denote the same moment but
 * do not compare equal, so a mixed-format codebase would drop or duplicate
 * slots at exactly the boundaries that matter.
 */
export function toInstant(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error(`Invalid instant: ${JSON.stringify(value)}`), { status: 400 });
  }
  return d.toISOString();
}

/**
 * Timezone primitives.
 *
 * The one rule this module exists to enforce: an instant and a wall-clock time
 * are different types. An instant is an ISO string in UTC. A wall clock is a
 * (date, minutes-from-midnight) pair that means nothing until you name a zone.
 * Every conversion between them goes through here, so there is exactly one
 * place where DST can be got wrong - and it is covered by tests.
 */

export function isValidTimezone(tz) {
  return typeof tz === 'string' && tz.length > 0 && IANAZone.isValidZone(tz);
}

export function assertTimezone(tz, label = 'timezone') {
  if (!isValidTimezone(tz)) {
    const err = new Error(`Invalid IANA ${label}: ${JSON.stringify(tz)}`);
    err.status = 400;
    throw err;
  }
  return tz;
}

/** '09:30' -> 570. Accepts '24:00' as 1440 so a window can end at midnight. */
export function timeToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) throw Object.assign(new Error(`Invalid time "${value}", expected HH:MM`), { status: 400 });
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 24 || mins > 59 || (hours === 24 && mins !== 0)) {
    throw Object.assign(new Error(`Invalid time "${value}"`), { status: 400 });
  }
  return hours * 60 + mins;
}

/** 570 -> '09:30' */
export function minutesToTime(total) {
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Resolve a wall-clock time on a local date, in `zone`, to a UTC instant.
 *
 * This deliberately builds the DateTime from calendar fields rather than
 * adding minutes to local midnight. On a DST day those differ: 2026-03-08 in
 * America/New_York is a 23-hour day, so midnight + 540 minutes lands on 10:00
 * local, while "09:00 on that date" is what a provider actually means.
 *
 * Luxon's resolution for the two awkward cases is what we want:
 *  - nonexistent wall clock (spring forward gap) shifts forward past the gap
 *  - ambiguous wall clock (autumn fall-back) resolves to the earlier offset
 *
 * `minutes` may be 1440, meaning midnight at the end of the date.
 */
export function wallClockToInstant(isoDate, minutes, zone) {
  const base = DateTime.fromISO(isoDate, { zone });
  if (!base.isValid) {
    throw Object.assign(new Error(`Invalid date "${isoDate}": ${base.invalidReason}`), {
      status: 400,
    });
  }
  const dayOffset = Math.floor(minutes / 1440);
  const withinDay = minutes % 1440;
  const day = dayOffset === 0 ? base : base.plus({ days: dayOffset });
  const dt = DateTime.fromObject(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: Math.floor(withinDay / 60),
      minute: withinDay % 60,
    },
    { zone },
  );
  if (!dt.isValid) {
    throw Object.assign(new Error(`Cannot resolve ${isoDate} ${minutesToTime(minutes)} in ${zone}`), {
      status: 400,
    });
  }
  return toInstant(dt.toUTC().toISO());
}

/** UTC instant -> the local calendar date ('2026-03-08') it falls on in `zone`. */
export function instantToLocalDate(instant, zone) {
  return DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).toISODate();
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of a local date. */
export function localDateWeekday(isoDate) {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).weekday;
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function eachLocalDate(startDate, endDate) {
  const out = [];
  let cursor = DateTime.fromISO(startDate, { zone: 'utc' });
  const last = DateTime.fromISO(endDate, { zone: 'utc' });
  if (!cursor.isValid || !last.isValid) {
    throw Object.assign(new Error('Invalid date range'), { status: 400 });
  }
  // Guard against a pathological range turning into an unbounded loop.
  let guard = 0;
  while (cursor <= last && guard++ < 800) {
    out.push(cursor.toISODate());
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

export function shiftDate(isoDate, days) {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days }).toISODate();
}

export function addMinutes(instant, minutes) {
  return toInstant(DateTime.fromISO(instant, { zone: 'utc' }).plus({ minutes }).toUTC().toISO());
}

export function diffMinutes(a, b) {
  return Interval.fromDateTimes(
    DateTime.fromISO(a, { zone: 'utc' }),
    DateTime.fromISO(b, { zone: 'utc' }),
  ).length('minutes');
}

/**
 * Half-open overlap: [aStart, aEnd) vs [bStart, bEnd).
 * Half-open is what makes 10:00-11:00 and 11:00-12:00 adjacent rather than
 * conflicting, and it matches the '[)' bound used by the tstzrange in the
 * database - the same comparison, expressed twice, deliberately.
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Merge overlapping/touching {startMinute,endMinute} windows into a clean set. */
export function mergeWindows(windows) {
  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
  const merged = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, w.endMinute);
    } else {
      merged.push({ startMinute: w.startMinute, endMinute: w.endMinute });
    }
  }
  return merged;
}

/**
 * Render one instant for one audience. Every user-facing time in the app and
 * in emails goes through this, so a zone label is never optional.
 */
export function formatForZone(instant, zone, { includeZone = true } = {}) {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone);
  const base = dt.toFormat('ccc d LLL yyyy, HH:mm');
  return includeZone ? `${base} (${dt.offsetNameShort} - ${zone})` : base;
}

export function nowInstant() {
  return new Date().toISOString();
}
