import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction, PG_ERRORS } from '../../db/index.js';
import { asyncRoute, validate, requireAuth, requireRole } from '../../middleware/index.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { isValidTimezone, timeToMinutes } from '../../lib/time.js';
import {
  getProviderOrFail,
  assertCanManageProvider,
  serializeProvider,
  serializeRule,
  serializeException,
  getRules,
} from './provider.repo.js';

export const router = Router();

const timezoneField = z.string().refine(isValidTimezone, {
  message: 'Must be a valid IANA timezone, e.g. Europe/Berlin',
});
const timeField = z.string().regex(/^(?:[01]\d|2[0-4]):[0-5]\d$/, 'Expected HH:MM');
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const settingsShape = {
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and hyphens only'),
  description: z.string().max(2000).default(''),
  timezone: timezoneField,
  bufferMinutes: z.number().int().min(0).max(480).default(0),
  slotMinutes: z.number().int().min(5).max(1440).default(30),
  minNoticeMinutes: z.number().int().min(0).max(60 * 24 * 30).default(60),
  bookingHorizonDays: z.number().int().min(1).max(730).default(60),
  cancellationCutoffHours: z.number().int().min(0).max(24 * 30).default(24),
};

const createProviderSchema = z.object({
  ...settingsShape,
  userId: z.string().uuid().nullish(),
});
const updateProviderSchema = z.object(settingsShape).partial();

// --------------------------------------------------------------- listing ---
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const includeInactive = req.user?.role === 'admin' && req.query.includeInactive === 'true';
    const { rows } = await query(
      `SELECT * FROM providers ${includeInactive ? '' : 'WHERE is_active'} ORDER BY name`,
    );
    res.json({ providers: rows.map(serializeProvider) });
  }),
);

router.get(
  '/:idOrSlug',
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    const rules = await getRules(provider.id);
    res.json({ provider: serializeProvider(provider), availabilityRules: rules.map(serializeRule) });
  }),
);

// -------------------------------------------------------- create / update ---
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate(createProviderSchema),
  asyncRoute(async (req, res) => {
    const b = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO providers
           (user_id, name, slug, description, timezone, buffer_minutes, slot_minutes,
            min_notice_minutes, booking_horizon_days, cancellation_cutoff_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          b.userId ?? null,
          b.name,
          b.slug,
          b.description,
          b.timezone,
          b.bufferMinutes,
          b.slotMinutes,
          b.minNoticeMinutes,
          b.bookingHorizonDays,
          b.cancellationCutoffHours,
        ],
      );
      res.status(201).json({ provider: serializeProvider(rows[0]) });
    } catch (err) {
      if (err.code === PG_ERRORS.UNIQUE_VIOLATION) throw conflict('That slug is taken', 'SLUG_TAKEN');
      throw err;
    }
  }),
);

const COLUMN_FOR = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  timezone: 'timezone',
  bufferMinutes: 'buffer_minutes',
  slotMinutes: 'slot_minutes',
  minNoticeMinutes: 'min_notice_minutes',
  bookingHorizonDays: 'booking_horizon_days',
  cancellationCutoffHours: 'cancellation_cutoff_hours',
};

router.patch(
  '/:idOrSlug',
  requireAuth,
  validate(updateProviderSchema),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);

    const entries = Object.entries(req.body).filter(([k]) => k in COLUMN_FOR);
    if (entries.length === 0) throw badRequest('Nothing to update');

    const updated = await withTransaction(async (client) => {
      const sets = entries.map(([k], i) => `${COLUMN_FOR[k]} = $${i + 2}`);
      const values = entries.map(([, v]) => v);
      const { rows } = await client.query(
        `UPDATE providers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        [provider.id, ...values],
      );

      // Changing the buffer has to reach existing rows, otherwise the gap the
      // provider just configured would only apply to bookings made from now on.
      // Raising it can genuinely conflict with an already-booked pair; the
      // exclusion constraint says so and we surface that instead of silently
      // leaving the calendar inconsistent.
      if (req.body.bufferMinutes !== undefined && req.body.bufferMinutes !== provider.buffer_minutes) {
        try {
          await client.query(
            `UPDATE bookings
                SET buffer_minutes = $2
              WHERE provider_id = $1
                AND status = 'confirmed'
                AND starts_at > now()`,
            [provider.id, req.body.bufferMinutes],
          );
        } catch (err) {
          if (err.code === PG_ERRORS.EXCLUSION_VIOLATION) {
            throw conflict(
              'That buffer would overlap bookings already on the calendar. Move or cancel them first.',
              'BUFFER_CONFLICTS_WITH_BOOKINGS',
            );
          }
          throw err;
        }
      }
      return rows[0];
    });

    res.json({ provider: serializeProvider(updated) });
  }),
);

router.delete(
  '/:idOrSlug',
  requireAuth,
  requireRole('admin'),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    // Deactivate rather than delete: bookings in the past are records.
    await query('UPDATE providers SET is_active = false WHERE id = $1', [provider.id]);
    res.status(204).end();
  }),
);

// --------------------------------------------------- availability: rules ---
const ruleSchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: timeField,
    endTime: timeField,
    effectiveFrom: dateField.nullish(),
    effectiveTo: dateField.nullish(),
  })
  .refine((r) => timeToMinutes(r.endTime) > timeToMinutes(r.startTime), {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });

router.get(
  '/:idOrSlug/availability',
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    const rules = await getRules(provider.id);
    const { rows: exceptions } = await query(
      `SELECT * FROM availability_exceptions
        WHERE provider_id = $1 AND exception_date >= (now() AT TIME ZONE $2)::date - 7
        ORDER BY exception_date`,
      [provider.id, provider.timezone],
    );
    res.json({
      timezone: provider.timezone,
      rules: rules.map(serializeRule),
      exceptions: exceptions.map(serializeException),
    });
  }),
);

router.post(
  '/:idOrSlug/availability/rules',
  requireAuth,
  validate(ruleSchema),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO availability_rules
         (provider_id, day_of_week, start_minute, end_minute, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        provider.id,
        b.dayOfWeek,
        timeToMinutes(b.startTime),
        timeToMinutes(b.endTime),
        b.effectiveFrom ?? null,
        b.effectiveTo ?? null,
      ],
    );
    res.status(201).json({ rule: serializeRule(rows[0]) });
  }),
);

/** Replace the whole weekly pattern in one call - what the UI editor uses. */
router.put(
  '/:idOrSlug/availability/rules',
  requireAuth,
  validate(z.object({ rules: z.array(ruleSchema).max(100) })),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);

    const saved = await withTransaction(async (client) => {
      await client.query('DELETE FROM availability_rules WHERE provider_id = $1', [provider.id]);
      const out = [];
      for (const r of req.body.rules) {
        const { rows } = await client.query(
          `INSERT INTO availability_rules
             (provider_id, day_of_week, start_minute, end_minute, effective_from, effective_to)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            provider.id,
            r.dayOfWeek,
            timeToMinutes(r.startTime),
            timeToMinutes(r.endTime),
            r.effectiveFrom ?? null,
            r.effectiveTo ?? null,
          ],
        );
        out.push(rows[0]);
      }
      return out;
    });

    res.json({ rules: saved.map(serializeRule) });
  }),
);

router.delete(
  '/:idOrSlug/availability/rules/:ruleId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);
    const { rowCount } = await query(
      'DELETE FROM availability_rules WHERE id = $1 AND provider_id = $2',
      [req.params.ruleId, provider.id],
    );
    if (rowCount === 0) throw notFound('Availability rule not found');
    res.status(204).end();
  }),
);

// ---------------------------------------------- availability: exceptions ---
const exceptionSchema = z
  .object({
    date: dateField,
    kind: z.enum(['blocked', 'custom_hours']),
    startTime: timeField.nullish(),
    endTime: timeField.nullish(),
    note: z.string().max(500).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'custom_hours') {
      if (!v.startTime || !v.endTime) {
        ctx.addIssue({ code: 'custom', message: 'custom_hours needs startTime and endTime' });
      } else if (timeToMinutes(v.endTime) <= timeToMinutes(v.startTime)) {
        ctx.addIssue({ code: 'custom', message: 'endTime must be after startTime', path: ['endTime'] });
      }
    }
  });

router.post(
  '/:idOrSlug/availability/exceptions',
  requireAuth,
  validate(exceptionSchema),
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO availability_exceptions
         (provider_id, exception_date, kind, start_minute, end_minute, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        provider.id,
        b.date,
        b.kind,
        b.kind === 'custom_hours' ? timeToMinutes(b.startTime) : null,
        b.kind === 'custom_hours' ? timeToMinutes(b.endTime) : null,
        b.note,
      ],
    );
    res.status(201).json({ exception: serializeException(rows[0]) });
  }),
);

router.delete(
  '/:idOrSlug/availability/exceptions/:exceptionId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const provider = await getProviderOrFail(req.params.idOrSlug);
    assertCanManageProvider(req.user, provider);
    const { rowCount } = await query(
      'DELETE FROM availability_exceptions WHERE id = $1 AND provider_id = $2',
      [req.params.exceptionId, provider.id],
    );
    if (rowCount === 0) throw notFound('Exception not found');
    res.status(204).end();
  }),
);
