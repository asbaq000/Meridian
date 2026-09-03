import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../../db/index.js';
import { env } from '../../config/env.js';
import { asyncRoute, validate, requireAuth } from '../../middleware/index.js';
import { AppError, unauthorized, conflict } from '../../lib/errors.js';
import { isValidTimezone } from '../../lib/time.js';

export const router = Router();

const timezoneField = z
  .string()
  .refine(isValidTimezone, { message: 'Must be a valid IANA timezone, e.g. Europe/Berlin' });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).max(120),
  // Self-registration can only ever create a customer. Elevating to provider or
  // admin is an admin action, never something the request body can ask for.
  timezone: timezoneField.default('UTC'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  timezone: row.timezone,
  createdAt: row.created_at,
});

export function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

router.post(
  '/register',
  validate(registerSchema),
  asyncRoute(async (req, res) => {
    const { email, password, name, timezone } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, role, timezone)
       VALUES ($1, $2, $3, 'customer', $4)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING *`,
      [email, passwordHash, name, timezone],
    );

    if (rows.length === 0) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');

    const user = publicUser(rows[0]);
    res.status(201).json({ user, token: issueToken(rows[0]) });
  }),
);

router.post(
  '/login',
  validate(loginSchema),
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [
      req.body.email,
    ]);
    const row = rows[0];
    // Compare against a dummy hash when the user is missing so a failed login
    // costs the same either way and does not leak which emails exist.
    const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(req.body.password, hash);
    if (!row || !ok) throw unauthorized('Incorrect email or password');

    res.json({ user: publicUser(row), token: issueToken(row) });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) throw unauthorized();

    // Providers get their provider id back so the UI knows which calendar to open.
    const { rows: providerRows } = await query(
      'SELECT id, slug, name FROM providers WHERE user_id = $1 ORDER BY created_at',
      [req.user.id],
    );

    res.json({ user: publicUser(rows[0]), providers: providerRows });
  }),
);

const updateMeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: timezoneField.optional(),
});

router.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncRoute(async (req, res) => {
    const { name, timezone } = req.body;
    if (name === undefined && timezone === undefined) {
      throw new AppError('Nothing to update', { status: 400, code: 'NO_CHANGES' });
    }
    const { rows } = await query(
      `UPDATE users
          SET name     = COALESCE($2, name),
              timezone = COALESCE($3, timezone)
        WHERE id = $1
        RETURNING *`,
      [req.user.id, name ?? null, timezone ?? null],
    );
    res.json({ user: publicUser(rows[0]) });
  }),
);

export { publicUser };
