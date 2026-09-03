import {
  wallClockToInstant,
  instantToLocalDate,
  localDateWeekday,
  eachLocalDate,
  addMinutes,
  rangesOverlap,
  mergeWindows,
} from '../../lib/time.js';

/**
 * Pure slot generation. No database, no clock of its own - `now` is passed in.
 * That is what makes DST behaviour, buffers and horizon rules testable without
 * a server, and it is why this file is the first thing the test suite covers.
 *
 * The pipeline for each provider-local date:
 *
 *   recurring rules for that weekday
 *     -> replaced wholesale by a custom_hours exception, if one exists
 *     -> dropped entirely by a blocked exception
 *     -> merged into non-overlapping wall-clock windows
 *     -> resolved to UTC instants against the provider's zone (DST happens here)
 *     -> walked in `granularity` steps to produce candidate slots
 *     -> filtered against min-notice, horizon, and existing reserved ranges
 */

/** Wall-clock windows available on one provider-local date. */
export function windowsForDate(isoDate, { rules, exceptions }) {
  const dayExceptions = exceptions.filter((e) => e.exception_date === isoDate);

  if (dayExceptions.some((e) => e.kind === 'blocked')) return [];

  const custom = dayExceptions.filter((e) => e.kind === 'custom_hours');
  if (custom.length > 0) {
    // A custom-hours exception replaces the recurring pattern for that date
    // rather than adding to it. "Open 10-2 on the Saturday of the fair" should
    // not also inherit the usual Saturday hours.
    return mergeWindows(
      custom.map((e) => ({ startMinute: e.start_minute, endMinute: e.end_minute })),
    );
  }

  const weekday = localDateWeekday(isoDate);
  const applicable = rules.filter(
    (r) =>
      r.day_of_week === weekday &&
      (!r.effective_from || isoDate >= r.effective_from) &&
      (!r.effective_to || isoDate <= r.effective_to),
  );
  return mergeWindows(
    applicable.map((r) => ({ startMinute: r.start_minute, endMinute: r.end_minute })),
  );
}

/**
 * The window a booking actually consumes on the provider's calendar: the
 * appointment plus the trailing buffer. Mirrors the `reserved_range` trigger
 * in migration 002 exactly - if these two ever disagree, the database wins and
 * a slot the UI offered would be rejected on submit, so they are kept in step
 * on purpose and asserted against each other in the tests.
 */
export function reservedWindow(startsAt, endsAt, bufferMinutes) {
  return { start: startsAt, end: addMinutes(endsAt, bufferMinutes || 0) };
}

/** True when a candidate appointment can coexist with everything in `busy`. */
export function isSlotFree(startsAt, endsAt, bufferMinutes, busy) {
  const candidate = reservedWindow(startsAt, endsAt, bufferMinutes);
  return !busy.some((b) => rangesOverlap(candidate.start, candidate.end, b.start, b.end));
}

/**
 * Turn stored bookings into reserved windows.
 * Only confirmed rows occupy the calendar; cancelling frees a slot with no
 * other bookkeeping, which is exactly what the brief asks for.
 */
export function busyWindowsFromBookings(bookings, { excludeBookingId = null } = {}) {
  return bookings
    .filter((b) => b.status === 'confirmed' && b.id !== excludeBookingId)
    .map((b) => reservedWindow(b.starts_at, b.ends_at, b.buffer_minutes));
}

/**
 * @param {object}   input
 * @param {object}   input.provider        provider row (timezone, buffers, horizon...)
 * @param {Array}    input.rules           availability_rules rows
 * @param {Array}    input.exceptions      availability_exceptions rows
 * @param {Array}    input.busy            reserved windows, from busyWindowsFromBookings
 * @param {string}   input.fromDate        first provider-local date to scan (YYYY-MM-DD)
 * @param {string}   input.toDate          last provider-local date to scan
 * @param {number}   input.durationMinutes appointment length
 * @param {number}  [input.granularity]    spacing of offered start times
 * @param {string}   input.now             current instant (ISO UTC)
 * @returns {Array<{startsAt:string, endsAt:string}>} UTC instants, ascending
 */
export function generateSlots({
  provider,
  rules = [],
  exceptions = [],
  busy = [],
  fromDate,
  toDate,
  durationMinutes,
  granularity,
  now,
}) {
  const zone = provider.timezone;
  const duration = durationMinutes || provider.slot_minutes;
  const step = granularity || provider.slot_minutes;
  const buffer = provider.buffer_minutes || 0;

  const earliestStart = addMinutes(now, provider.min_notice_minutes ?? 0);
  const latestStart = addMinutes(now, (provider.booking_horizon_days ?? 60) * 24 * 60);

  const slots = [];

  for (const isoDate of eachLocalDate(fromDate, toDate)) {
    for (const window of windowsForDate(isoDate, { rules, exceptions })) {
      const windowStart = wallClockToInstant(isoDate, window.startMinute, zone);
      const windowEnd = wallClockToInstant(isoDate, window.endMinute, zone);

      // Walking by real elapsed minutes (rather than by wall clock) is correct
      // across a DST boundary inside a window: on a spring-forward morning the
      // 02:00-02:59 starts simply do not exist, and stepping in real time skips
      // them without any special case. The window's own end was resolved from
      // wall clock, so a 23-hour day is genuinely one hour shorter.
      let cursor = windowStart;
      let guard = 0;
      while (cursor < windowEnd && guard++ < 2000) {
        const slotEnd = addMinutes(cursor, duration);
        if (slotEnd > windowEnd) break; // appointment must fit inside the window

        if (cursor >= earliestStart && cursor <= latestStart && isSlotFree(cursor, slotEnd, buffer, busy)) {
          slots.push({ startsAt: cursor, endsAt: slotEnd });
        }
        cursor = addMinutes(cursor, step);
      }
    }
  }

  slots.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  // Two overlapping availability windows on the same day could otherwise emit
  // the same start twice.
  return slots.filter((s, i) => i === 0 || s.startsAt !== slots[i - 1].startsAt);
}

/**
 * Group slots by the calendar date they fall on *in the viewer's zone*.
 *
 * This is the join between the two timezones in the brief. A provider in
 * Berlin offering 08:00-09:00 slots produces, for a customer in Los Angeles,
 * slots on the previous local date. Grouping in the viewer's zone is what
 * makes the customer's date picker agree with the times printed under it.
 */
export function groupByLocalDate(slots, viewerTimezone) {
  const byDate = new Map();
  for (const slot of slots) {
    const date = instantToLocalDate(slot.startsAt, viewerTimezone);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(slot);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, items]) => ({ date, slots: items }));
}
