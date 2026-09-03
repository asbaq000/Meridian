#!/usr/bin/env node
// One-shot reminder sweep, for cron / a platform scheduler:
//   node src/jobs/runReminders.js
import { runReminderSweep } from './reminders.js';
import { closePool } from '../db/index.js';

try {
  const result = await runReminderSweep();
  console.log(JSON.stringify(result));
} catch (err) {
  console.error('[reminders]', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
