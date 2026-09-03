import { describe, it, expect } from 'vitest';
import {
  generateSlots,
  windowsForDate,
  groupByLocalDate,
  reservedWindow,
  isSlotFree,
} from '../src/modules/slots/slotEngine.js';
import {
  wallClockToInstant,
  instantToLocalDate,
  timeToMinutes,
  minutesToTime,
  mergeWindows,
  formatForZone,
} from '../src/lib/time.js';

const provider = (over = {}) => ({
  id: 'p1',
  timezone: 'Europe/Berlin',
  buffer_minutes: 0,
  slot_minutes: 30,
  min_notice_minutes: 0,
  booking_horizon_days: 365,
  ...over,
});

const rule = (day, from, to, over = {}) => ({
  id: `r-${day}-${from}`,
  day_of_week: day,
  start_minute: timeToMinutes(from),
  end_minute: timeToMinutes(to),
  effective_from: null,
  effective_to: null,
  ...over,
});

const localTimes = (slots, zone) =>
  slots.map((s) => formatForZone(s.startsAt, zone, { includeZone: false }).slice(-5));

// A fixed "now" well before every fixture date, so horizon/notice never
// interfere unless a test is specifically about them.
const NOW = '2026-01-01T00:00:00.000Z';

// -------------------------------------------------------------- wall clock --
describe('wall clock <-> instant', () => {
  it('resolves a local time against the provider zone', () => {
    // 2026-06-15 is CEST (UTC+2): 09:00 local === 07:00Z
    expect(wallClockToInstant('2026-06-15', timeToMinutes('09:00'), 'Europe/Berlin')).toBe(
      '2026-06-15T07:00:00.000Z',
    );
    // 2026-01-15 is CET (UTC+1): 09:00 local === 08:00Z
    expect(wallClockToInstant('2026-01-15', timeToMinutes('09:00'), 'Europe/Berlin')).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('treats end_minute 1440 as midnight ending the date', () => {
    expect(wallClockToInstant('2026-06-15', 1440, 'UTC')).toBe('2026-06-16T00:00:00.000Z');
  });

  it('round-trips HH:MM', () => {
    expect(minutesToTime(timeToMinutes('09:05'))).toBe('09:05');
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(() => timeToMinutes('25:00')).toThrow();
    expect(() => timeToMinutes('9am')).toThrow();
  });

  it('merges overlapping and touching windows', () => {
    expect(mergeWindows([{ startMinute: 540, endMinute: 720 }, { startMinute: 660, endMinute: 900 }]))
      .toEqual([{ startMinute: 540, endMinute: 900 }]);
    expect(mergeWindows([{ startMinute: 540, endMinute: 720 }, { startMinute: 720, endMinute: 900 }]))
      .toEqual([{ startMinute: 540, endMinute: 900 }]);
    expect(mergeWindows([{ startMinute: 540, endMinute: 600 }, { startMinute: 900, endMinute: 960 }]))
      .toHaveLength(2);
  });
});

// -------------------------------------------------------------- windows -----
describe('windowsForDate', () => {
  const rules = [rule(1, '09:00', '17:00'), rule(2, '09:00', '12:00'), rule(2, '13:00', '17:00')];

  it('picks the rules for the right ISO weekday', () => {
    // 2026-06-15 is a Monday
    expect(windowsForDate('2026-06-15', { rules, exceptions: [] })).toEqual([
      { startMinute: 540, endMinute: 1020 },
    ]);
    // Tuesday has a lunch break: two separate windows
    expect(windowsForDate('2026-06-16', { rules, exceptions: [] })).toHaveLength(2);
    // Wednesday has no rule
    expect(windowsForDate('2026-06-17', { rules, exceptions: [] })).toEqual([]);
  });

  it('honours effective_from / effective_to', () => {
    const seasonal = [rule(1, '09:00', '17:00', { effective_from: '2026-07-01' })];
    expect(windowsForDate('2026-06-15', { rules: seasonal, exceptions: [] })).toEqual([]);
    expect(windowsForDate('2026-07-06', { rules: seasonal, exceptions: [] })).toHaveLength(1);
  });

  it('a blocked exception wipes the date', () => {
    const exceptions = [{ exception_date: '2026-06-15', kind: 'blocked' }];
    expect(windowsForDate('2026-06-15', { rules, exceptions })).toEqual([]);
    expect(windowsForDate('2026-06-22', { rules, exceptions })).toHaveLength(1);
  });

  it('custom hours replace the recurring pattern rather than adding to it', () => {
    const exceptions = [
      { exception_date: '2026-06-15', kind: 'custom_hours', start_minute: 600, end_minute: 780 },
    ];
    expect(windowsForDate('2026-06-15', { rules, exceptions })).toEqual([
      { startMinute: 600, endMinute: 780 },
    ]);
  });
});

// ---------------------------------------------------------- slot generation --
describe('generateSlots', () => {
  const rules = [rule(1, '09:00', '12:00')]; // Mondays 09:00-12:00 Berlin

  it('derives slots from rules rather than a fixed table', () => {
    const slots = generateSlots({
      provider: provider(),
      rules,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 30,
      now: NOW,
    });
    expect(slots).toHaveLength(6);
    expect(localTimes(slots, 'Europe/Berlin')).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    ]);
    expect(slots.at(-1).endsAt).toBe(wallClockToInstant('2026-06-15', 720, 'Europe/Berlin'));
  });

  it('never emits an appointment that spills past the window end', () => {
    const slots = generateSlots({
      provider: provider(),
      rules,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 45, // 09:00, 09:30, 10:00, 10:30, 11:00 would end 11:45; 11:30 would end 12:15
      granularity: 30,
      now: NOW,
    });
    expect(localTimes(slots, 'Europe/Berlin')).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('respects min notice and booking horizon', () => {
    const near = generateSlots({
      provider: provider({ min_notice_minutes: 60 }),
      rules,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 30,
      // 09:15 Berlin. +60m notice = 10:15, so 10:30 is the first bookable start.
      now: '2026-06-15T07:15:00.000Z',
    });
    expect(localTimes(near, 'Europe/Berlin')).toEqual(['10:30', '11:00', '11:30']);

    const beyond = generateSlots({
      provider: provider({ booking_horizon_days: 3 }),
      rules,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 30,
      now: '2026-06-01T00:00:00.000Z',
    });
    expect(beyond).toEqual([]);
  });

  it('removes slots taken by a confirmed booking', () => {
    const busy = [
      reservedWindow(
        wallClockToInstant('2026-06-15', timeToMinutes('10:00'), 'Europe/Berlin'),
        wallClockToInstant('2026-06-15', timeToMinutes('10:30'), 'Europe/Berlin'),
        0,
      ),
    ];
    const slots = generateSlots({
      provider: provider(),
      rules,
      busy,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 30,
      now: NOW,
    });
    expect(localTimes(slots, 'Europe/Berlin')).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it('applies the buffer on both sides of an existing booking', () => {
    // 15m buffer, 10:00-10:30 booked. The buffer is trailing-only per booking,
    // but because BOTH the existing row and the candidate carry one, the net
    // effect is a 15m gap either side: 09:30 (ends 10:00, +15 = 10:15 > 10:00)
    // and 10:30 (starts before the existing 10:45 buffered end) both go.
    const busy = [
      reservedWindow(
        wallClockToInstant('2026-06-15', timeToMinutes('10:00'), 'Europe/Berlin'),
        wallClockToInstant('2026-06-15', timeToMinutes('10:30'), 'Europe/Berlin'),
        15,
      ),
    ];
    const slots = generateSlots({
      provider: provider({ buffer_minutes: 15 }),
      rules,
      busy,
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 30,
      granularity: 30,
      now: NOW,
    });
    expect(localTimes(slots, 'Europe/Berlin')).toEqual(['09:00', '11:00', '11:30']);
  });

  it('leaves exactly `buffer` minutes between back-to-back bookings', () => {
    const busy = [
      reservedWindow(
        wallClockToInstant('2026-06-15', timeToMinutes('10:00'), 'Europe/Berlin'),
        wallClockToInstant('2026-06-15', timeToMinutes('10:30'), 'Europe/Berlin'),
        15,
      ),
    ];
    const start = wallClockToInstant('2026-06-15', timeToMinutes('10:45'), 'Europe/Berlin');
    const end = wallClockToInstant('2026-06-15', timeToMinutes('11:15'), 'Europe/Berlin');
    expect(isSlotFree(start, end, 15, busy)).toBe(true);

    const tooSoon = wallClockToInstant('2026-06-15', timeToMinutes('10:44'), 'Europe/Berlin');
    expect(isSlotFree(tooSoon, end, 15, busy)).toBe(false);
  });

  it('treats adjacent appointments as non-conflicting when there is no buffer', () => {
    const busy = [
      reservedWindow(
        wallClockToInstant('2026-06-15', timeToMinutes('10:00'), 'Europe/Berlin'),
        wallClockToInstant('2026-06-15', timeToMinutes('10:30'), 'Europe/Berlin'),
        0,
      ),
    ];
    const start = wallClockToInstant('2026-06-15', timeToMinutes('10:30'), 'Europe/Berlin');
    const end = wallClockToInstant('2026-06-15', timeToMinutes('11:00'), 'Europe/Berlin');
    expect(isSlotFree(start, end, 0, busy)).toBe(true);
  });
});

// ------------------------------------------------------------------ DST -----
describe('daylight saving', () => {
  it('keeps a 09:00 rule at 09:00 local across a spring-forward date', () => {
    // America/New_York springs forward 2026-03-08 (a Sunday). The Monday after
    // is a normal 24h day but a different UTC offset from the Friday before.
    const rules = [rule(5, '09:00', '10:00'), rule(1, '09:00', '10:00')];
    const slots = generateSlots({
      provider: provider({ timezone: 'America/New_York' }),
      rules,
      fromDate: '2026-03-06', // Friday, EST (UTC-5)
      toDate: '2026-03-09', //   Monday, EDT (UTC-4)
      durationMinutes: 60,
      now: NOW,
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2026-03-06T14:00:00.000Z', // 09:00 EST
      '2026-03-09T13:00:00.000Z', // 09:00 EDT - one hour earlier in UTC
    ]);
    expect(localTimes(slots, 'America/New_York')).toEqual(['09:00', '09:00']);
  });

  it('skips the wall-clock hour that does not exist on a spring-forward day', () => {
    // 2026-03-08, America/New_York: 02:00-02:59 never happens.
    const rules = [rule(7, '01:00', '05:00')]; // Sunday 01:00-05:00
    const slots = generateSlots({
      provider: provider({ timezone: 'America/New_York' }),
      rules,
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      durationMinutes: 60,
      granularity: 60,
      now: NOW,
    });
    // A 4-hour wall-clock window on a 23-hour day yields 3 hourly slots.
    expect(localTimes(slots, 'America/New_York')).toEqual(['01:00', '03:00', '04:00']);
    expect(slots).toHaveLength(3);
  });

  it('produces the extra hour on an autumn fall-back day', () => {
    // 2026-11-01, America/New_York: 01:00-01:59 happens twice.
    const rules = [rule(7, '00:00', '04:00')];
    const slots = generateSlots({
      provider: provider({ timezone: 'America/New_York' }),
      rules,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
      durationMinutes: 60,
      granularity: 60,
      now: NOW,
    });
    // A 4-hour wall-clock window on a 25-hour day yields 5 hourly slots, with
    // 01:00 appearing twice at two distinct instants.
    expect(slots).toHaveLength(5);
    expect(localTimes(slots, 'America/New_York')).toEqual(['00:00', '01:00', '01:00', '02:00', '03:00']);
    expect(new Set(slots.map((s) => s.startsAt)).size).toBe(5);
  });
});

// ------------------------------------------------------- cross-timezone -----
describe('cross-timezone viewing', () => {
  it('the same instant carries different local dates for provider and customer', () => {
    // Provider in Auckland offers Monday 09:00. For a customer in Los Angeles
    // that is the previous calendar day.
    const slots = generateSlots({
      provider: provider({ timezone: 'Pacific/Auckland' }),
      rules: [rule(1, '09:00', '10:00')],
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 60,
      now: NOW,
    });
    const [slot] = slots;
    expect(slot.startsAt).toBe('2026-06-14T21:00:00.000Z');

    expect(instantToLocalDate(slot.startsAt, 'Pacific/Auckland')).toBe('2026-06-15');
    expect(instantToLocalDate(slot.startsAt, 'America/Los_Angeles')).toBe('2026-06-14');

    expect(formatForZone(slot.startsAt, 'Pacific/Auckland', { includeZone: false }))
      .toBe('Mon 15 Jun 2026, 09:00');
    expect(formatForZone(slot.startsAt, 'America/Los_Angeles', { includeZone: false }))
      .toBe('Sun 14 Jun 2026, 14:00');
  });

  it('groups slots by the viewer local date, not the provider one', () => {
    const slots = generateSlots({
      provider: provider({ timezone: 'Pacific/Auckland' }),
      rules: [rule(1, '09:00', '11:00')],
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      durationMinutes: 60,
      now: NOW,
    });
    expect(groupByLocalDate(slots, 'Pacific/Auckland')).toEqual([
      { date: '2026-06-15', slots },
    ]);
    expect(groupByLocalDate(slots, 'America/Los_Angeles')[0].date).toBe('2026-06-14');
  });
});
