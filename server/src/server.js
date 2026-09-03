import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, query } from './db/index.js';
import { startReminderScheduler, stopReminderScheduler } from './jobs/reminders.js';

const app = createApp();

// Fail loudly at boot rather than on the first request: a missing or wrong
// DATABASE_URL should stop the process, not produce a server that 500s.
try {
  await query('SELECT 1');
} catch (err) {
  console.error(`[boot] cannot reach the database: ${err.message}`);
  console.error('[boot] check DATABASE_URL in server/.env');
  process.exit(1);
}

const server = app.listen(env.port, () => {
  console.log(`[boot] API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

startReminderScheduler();

const shutdown = async (signal) => {
  console.log(`\n[boot] ${signal} received, shutting down`);
  stopReminderScheduler();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
