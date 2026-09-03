import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate, requireAuth } from '../../middleware/index.js';
import { forbidden, badRequest } from '../../lib/errors.js';
import { isValidTimezone } from '../../lib/time.js';
import { getProviderOrFail } from '../providers/provider.repo.js';
import {
  createBooking,
  cancelBooking,
  rescheduleBooking,
  listBookings,
  loadBooking,
  serializeBooking,
  assertCanViewBooking,
} from './booking.service.js';

export const router = Router();

const instantField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Expected an ISO-8601 instant, e.g. 2026-06-15T07:00:00.000Z');

const createSchema = z.object({
  providerId: z.string().min(1), // uuid or slug
  startsAt: instantField,
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  notes: z.string().max(2000).default(''),
  // Admin-only: book a customer in, and optionally outside published hours.
  customerId: z.string().uuid().optional(),
  skipAvailabilityCheck: z.boolean().default(false),
});

router.post(
  '/',
  requireAuth,
  validate(createSchema),
  asyncRoute(async (req, res) => {
    const b = req.body;
    if (b.customerId && b.customerId !== req.user.id && req.user.role !== 'admin') {
      throw forbidden('Only an admin can book on behalf of someone else');
    }
    const booking = await createBooking({
      providerIdOrSlug: b.providerId,
      customerId: b.customerId ?? req.user.id,
      startsAt: b.startsAt,
      durationMinutes: b.durationMinutes,
      notes: b.notes,
      actor: req.user,
      skipAvailabilityCheck: b.skipAvailabilityCheck,
    });
    res.status(201).json({ booking: serializeBooking(booking, req.user.timezone) });
  }),
);

const listSchema = z.object({
  scope: z.enum(['mine', 'provider']).default('mine'),
  providerId: z.string().min(1).optional(),
  status: z.enum(['confirmed', 'cancelled', 'completed']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  timezone: z.string().refine(isValidTimezone, 'Must be a valid IANA timezone').optional(),
});

router.get(
  '/',
  requireAuth,
  validate(listSchema, 'query'),
  asyncRoute(async (req, res) => {
    const q = req.query;
    const filters = {
      status: q.status,
      fromInstant: q.from,
      toInstant: q.to,
      kind: 'appointment',
    };

    if (q.scope === 'provider') {
      if (!q.providerId) throw badRequest('providerId is required for scope=provider');
      const provider = await getProviderOrFail(q.providerId);
      if (req.user.role !== 'admin' && provider.user_id !== req.user.id) throw forbidden();
      filters.providerId = provider.id;
    } else {
      filters.customerId = req.user.id;
    }

    const rows = await listBookings(filters);
    res.json({ bookings: rows.map((r) => serializeBooking(r, q.timezone ?? undefined)) });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const booking = await loadBooking(req.params.id);
    const provider = await getProviderOrFail(booking.provider_id);
    assertCanViewBooking(req.user, booking, provider);
    res.json({ booking: serializeBooking(booking, req.query.timezone) });
  }),
);

const cancelSchema = z.object({
  reason: z.string().max(500).default(''),
});

router.post(
  '/:id/cancel',
  requireAuth,
  validate(cancelSchema),
  asyncRoute(async (req, res) => {
    // Cancelling is never refused - a booking inside the notice window is
    // simply recorded as a late cancellation. Only rescheduling still enforces
    // the cutoff.
    const booking = await cancelBooking({
      bookingId: req.params.id,
      actor: req.user,
      reason: req.body.reason,
    });
    res.json({ booking: serializeBooking(booking, req.query.timezone) });
  }),
);

const rescheduleSchema = z.object({
  startsAt: instantField,
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  override: z.boolean().default(false),
  skipAvailabilityCheck: z.boolean().default(false),
});

router.post(
  '/:id/reschedule',
  requireAuth,
  validate(rescheduleSchema),
  asyncRoute(async (req, res) => {
    const booking = await rescheduleBooking({
      bookingId: req.params.id,
      startsAt: req.body.startsAt,
      durationMinutes: req.body.durationMinutes,
      actor: req.user,
      override: req.body.override,
      skipAvailabilityCheck: req.body.skipAvailabilityCheck,
    });
    res.status(201).json({ booking: serializeBooking(booking, req.query.timezone) });
  }),
);
