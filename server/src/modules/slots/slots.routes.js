import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../../middleware/index.js';
import { badRequest } from '../../lib/errors.js';
import {
  isValidTimezone,
  instantToLocalDate,
  wallClockToInstant,
  shiftDate,
  eachLocalDate,
  nowInstant,
} from '../../lib/time.js';
import {
  getProviderOrFail,
  getRules,
  getExceptions,
  getConfirmedBookings,
} from '../providers/provider.repo.js';
import { generateSlots, busyWindowsFromBookings, groupByLocalDate } from './slotEngine.js';

export const router = Router({ mergeParams: true });

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional(),
  // The viewer's zone. Dates in `from`/`to` are interpreted in it, and slots
  // come back grouped by the viewer's local date - so a customer's date picker
  // and the times printed under it agree even when the provider is elsewhere.
  timezone: z.string().refine(isValidTimezone, 'Must be a valid IANA timezone').optional(),
  duration: z.coerce.number().int().min(5).max(1440).optional(),
  granularity: z.coerce.number().int().min(5).max(1440).optional(),
  // Used by the reschedule UI: ignore this booking when deciding what is free,
  // so its own current slot is still offered.
  excludeBookingId: z.string().uuid().optional(),
});

/**
 * GET /api/providers/:idOrSlug/slots?from=&to=&timezone=
 *
 * Returns bookable slots as UTC instants, grouped by the viewer's local date.
 */
router.get(
  '/',
  validate(querySchema, 'query'),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    const { from, timezone, duration, granularity, excludeBookingId } = req.query;
    const to = req.query.to ?? from;
    const viewerTz = timezone ?? provider.timezone;

    if (to < from) throw badRequest('`to` must not be before `from`');
    if (eachLocalDate(from, to).length > 62) {
      throw badRequest('Date range is limited to 62 days');
    }

    // The viewer's window [from 00:00, to+1 00:00) in the viewer's zone, as
    // instants. Everything downstream works in instants; this is the only
    // place the viewer's calendar is interpreted.
    const windowStart = wallClockToInstant(from, 0, viewerTz);
    const windowEnd = wallClockToInstant(shiftDate(to, 1), 0, viewerTz);

    // Scan a day either side in PROVIDER-local dates: a viewer-local date can
    // straddle two provider-local dates in both directions (Auckland/LA is a
    // ~21h spread), so the naive same-date scan drops slots at the edges.
    const scanFrom = shiftDate(instantToLocalDate(windowStart, provider.timezone), -1);
    const scanTo = shiftDate(instantToLocalDate(windowEnd, provider.timezone), 1);

    const [rules, exceptions, bookings] = await Promise.all([
      getRules(provider.id),
      getExceptions(provider.id, scanFrom, scanTo),
      // Widen the busy query by a day either side so a long appointment or a
      // buffer straddling the boundary is still seen.
      getConfirmedBookings(
        provider.id,
        wallClockToInstant(scanFrom, 0, provider.timezone),
        wallClockToInstant(shiftDate(scanTo, 1), 0, provider.timezone),
      ),
    ]);

    const all = generateSlots({
      provider,
      rules,
      exceptions,
      busy: busyWindowsFromBookings(bookings, { excludeBookingId }),
      fromDate: scanFrom,
      toDate: scanTo,
      durationMinutes: duration ?? provider.slot_minutes,
      granularity: granularity ?? provider.slot_minutes,
      now: nowInstant(),
    });

    // Trim the padding back off, in the viewer's frame.
    const slots = all.filter((s) => s.startsAt >= windowStart && s.startsAt < windowEnd);

    res.json({
      provider: {
        id: provider.id,
        slug: provider.slug,
        name: provider.name,
        timezone: provider.timezone,
        bufferMinutes: provider.buffer_minutes,
        slotMinutes: provider.slot_minutes,
        cancellationCutoffHours: provider.cancellation_cutoff_hours,
      },
      viewerTimezone: viewerTz,
      durationMinutes: duration ?? provider.slot_minutes,
      range: { from, to },
      days: groupByLocalDate(slots, viewerTz),
      count: slots.length,
    });
  }),
);
