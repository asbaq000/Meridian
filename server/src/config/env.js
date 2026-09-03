import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..', '..');

loadDotenv({ path: path.join(SERVER_ROOT, '.env') });

const bool = (v, fallback) => (v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v));
const int = (v, fallback) => (v === undefined || v === '' ? fallback : Number.parseInt(v, 10));

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const env = {
  isTest,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 4000),

  // Tests run against a separate database because they truncate tables.
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'Smart Booking <onboarding@resend.dev>',

  remindersEnabled: bool(process.env.REMINDERS_ENABLED, !isTest),
  reminderIntervalMs: int(process.env.REMINDER_INTERVAL_MS, 5 * 60 * 1000),
  reminderLeadHours: int(process.env.REMINDER_LEAD_HOURS, 24),
};

export function assertDatabaseUrl() {
  if (!env.databaseUrl) {
    const which = env.isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
    throw new Error(
      `${which} is not set. Copy server/.env.example to server/.env and fill in a Postgres connection string.`,
    );
  }
}
