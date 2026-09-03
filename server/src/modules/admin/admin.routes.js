import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/index.js';
import { asyncRoute, validate, requireAuth, requireRole } from '../../middleware/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { isValidTimezone, wallClockToInstant, shiftDate, eachLocalDate } from '../../lib/time.js';
import { getProviderOrFail } from '../providers/provider.repo.js';
import {
  listBookings,
  serializeBooking,
  createBlock,
  cancelBooking,
  loadBooking,
} from '../bookings/booking.service.js';
import { runReminderSweep } from '../../jobs/reminders.js';

export const router = Router();

router.use(requireAuth, requireRole('admin'));

const instantField = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Expected an ISO instant');
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// --------------------------------------------------------------- calendar ---
const calendarSchema = z.object({
  from: dateField,
  to: dateField,
  timezone: z.string().refine(isValidTimezone, 'Must be a valid IANA timezone').default('UTC'),
  providerId: z.string().min(1).optional(),
});

/**
 * Every booking and block across every provider in one window.
 * The window is interpreted in the admin's own timezone, and each booking
 * still carries provider-local and customer-local renderings, so an admin
 * looking at a global calendar is never guessing whose clock a row is on.
 */
router.get(
  '/calendar',
  validate(calendarSchema, 'query'),
  asyncRoute(async (req, res) => {
    const { from, to, timezone, providerId } = req.query;
    if (to < from) throw badRequest('`to` must not be before `from`');
    if (eachLocalDate(from, to).length > 92) throw badRequest('Range is limited to 92 days');

    const fromInstant = wallClockToInstant(from, 0, timezone);
    const toInstant = wallClockToInstant(shiftDate(to, 1), 0, timezone);

    const provider = providerId ? await getProviderOrFail(providerId) : null;

    const rows = await listBookings({
      providerId: provider?.id,
      fromInstant,
      toInstant,
      limit: 1000,
    });

    const { rows: providers } = await query(
      'SELECT id, name, slug, timezone, is_active FROM providers ORDER BY name',
    );

    res.json({
      range: { from, to, timezone },
      providers,
      bookings: rows.map((r) => serializeBooking(r, timezone)),
    });
  }),
);

// ----------------------------------------------------------- block time ---
const blockSchema = z
  .object({
    providerId: z.string().min(1),
    startsAt: instantField,
    endsAt: instantField,
    note: z.string().max(500).default(''),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

/**
 * Blocking time inserts a booking row with kind='block', so it is covered by
 * the same exclusion constraint as everything else. Two consequences worth
 * knowing: a block cannot be placed over an existing booking (you get a 409
 * telling you to move it first), and nothing can be booked over a block.
 */
router.post(
  '/blocks',
  validate(blockSchema),
  asyncRoute(async (req, res) => {
    const block = await createBlock({
      providerIdOrSlug: req.body.providerId,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      notes: req.body.note,
    });
    res.status(201).json({ block: serializeBooking(block) });
  }),
);

router.delete(
  '/blocks/:id',
  asyncRoute(async (req, res) => {
    const booking = await loadBooking(req.params.id);
    if (booking.kind !== 'block') throw badRequest('That is not a block');
    await query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [
      req.params.id,
    ]);
    res.status(204).end();
  }),
);

// ------------------------------------------------------------- overrides ---
/**
 * Force-cancel past the cutoff. Distinct from the customer-facing cancel route
 * only in that `override` defaults to true here - the audit trail records it
 * as an override either way.
 */
router.post(
  '/bookings/:id/override-cancel',
  validate(z.object({ reason: z.string().max(500).default('Cancelled by admin') })),
  asyncRoute(async (req, res) => {
    const booking = await cancelBooking({
      bookingId: req.params.id,
      actor: req.user,
      reason: req.body.reason,
      override: true,
    });
    res.json({ booking: serializeBooking(booking) });
  }),
);

// --------------------------------------------------------------- users ---
router.get(
  '/users',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      'SELECT id, email, name, role, timezone, created_at FROM users ORDER BY created_at DESC LIMIT 500',
    );
    res.json({ users: rows });
  }),
);

router.patch(
  '/users/:id/role',
  validate(z.object({ role: z.enum(['admin', 'provider', 'customer']) })),
  asyncRoute(async (req, res) => {
    const { rows } = await query(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, name, role, timezone',
      [req.params.id, req.body.role],
    );
    if (rows.length === 0) throw notFound('User not found');
    res.json({ user: rows[0] });
  }),
);

// ------------------------------------------------------ notifications ---
router.get(
  '/emails',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, booking_id, to_email, template, subject, transport, status, error, created_at
         FROM email_log ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ emails: rows });
  }),
);

/** Run the reminder sweep on demand, so it can be demonstrated without waiting. */
router.post(
  '/reminders/run',
  asyncRoute(async (_req, res) => {
    const result = await runReminderSweep();
    res.json(result);
  }),
);
