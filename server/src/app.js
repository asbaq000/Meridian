import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { query } from './db/index.js';
import {
  attachUser,
  errorHandler,
  notFoundHandler,
  asyncRoute,
} from './middleware/index.js';
import { router as authRouter } from './modules/auth/auth.routes.js';
import { router as providerRouter } from './modules/providers/provider.routes.js';
import { router as slotsRouter } from './modules/slots/slots.routes.js';
import { router as bookingsRouter } from './modules/bookings/bookings.routes.js';
import { router as adminRouter } from './modules/admin/admin.routes.js';
import { getTransport } from './services/email/index.js';
import { runReminderSweep } from './jobs/reminders.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  if (!env.isTest) app.use(morgan('dev'));
  app.use(attachUser);

  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      const { rows } = await query('SELECT now() AS db_time');
      res.json({
        ok: true,
        // Reported so a deployment can be checked for the one thing that would
        // silently break everything: a database that is not actually reachable.
        dbTime: rows[0].db_time,
        emailTransport: getTransport().name,
        env: env.nodeEnv,
      });
    }),
  );

  /**
   * Scheduled reminder sweep.
   *
   * On a long-lived process the sweep runs on an interval inside the app (see
   * jobs/reminders.js). A serverless function is frozen between requests, so
   * there is nothing to run a timer - the schedule has to come from outside,
   * and this is the door it knocks on. Vercel Cron calls it hourly and
   * presents CRON_SECRET as a bearer token.
   *
   * The sweep itself is unchanged and idempotent either way: it claims rows
   * with FOR UPDATE SKIP LOCKED, so an accidental double-invocation cannot
   * send a reminder twice.
   */
  app.get(
    '/api/cron/reminders',
    asyncRoute(async (req, res) => {
      const expected = env.cronSecret;
      const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      // Refusing when unconfigured is the safe default: an open endpoint that
      // sends email is worse than a cron job that visibly fails.
      if (!expected || presented !== expected) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid cron secret' } });
      }
      const result = await runReminderSweep();
      res.json({ ok: true, ...result });
    }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/providers', providerRouter);
  // Nested so the slots route inherits :idOrSlug from the provider path.
  app.use('/api/providers/:idOrSlug/slots', slotsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
