import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError, unauthorized, forbidden } from '../lib/errors.js';
import { PG_ERRORS } from '../db/index.js';

/** Wrap an async route so rejections reach the error handler. */
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Parse a bearer token if present. Never rejects - see `requireAuth`. */
export function attachUser(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) {
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      req.user = { id: payload.sub, role: payload.role, email: payload.email };
    } catch {
      req.user = undefined;
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Validate `req[source]` against a zod schema and replace it with the parsed value. */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError('Validation failed', {
          status: 422,
          code: 'VALIDATION_FAILED',
          details: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        }),
      );
    }
    // req.query is a getter in Express 5-style setups; assigning to a plain
    // property keeps this working either way.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: err.issues },
    });
  }

  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  // A raw exclusion violation reaching this far means a code path inserted a
  // booking without going through the bookings service. Surface it honestly as
  // a conflict rather than a 500 - the caller's retry is still the right move.
  if (err.code === PG_ERRORS.EXCLUSION_VIOLATION) {
    return res.status(409).json({
      error: { code: 'SLOT_TAKEN', message: 'That time is no longer available.' },
    });
  }
  if (err.code === PG_ERRORS.UNIQUE_VIOLATION) {
    return res
      .status(409)
      .json({ error: { code: 'ALREADY_EXISTS', message: 'That record already exists.' } });
  }

  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);

  res.status(status).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: status >= 500 && env.nodeEnv === 'production' ? 'Something went wrong' : err.message,
    },
  });
}
