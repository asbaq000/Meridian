import pg from 'pg';
import { env, assertDatabaseUrl } from '../config/env.js';

const { Pool, types } = pg;

// node-postgres hands back `timestamptz` as a JS Date by default, which is
// correct but silently drops sub-millisecond precision and invites accidental
// local-time formatting. We keep the raw ISO string and let Luxon do every
// conversion explicitly, so no layer of this app can format an instant without
// naming the zone it is formatting into.
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
const DATE_OID = 1082;
types.setTypeParser(TIMESTAMPTZ_OID, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(TIMESTAMP_OID, (v) => v);
types.setTypeParser(DATE_OID, (v) => v);
// int8 -> Number (row counts, never large enough to lose precision here).
types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

let pool;

export function getPool() {
  if (!pool) {
    assertDatabaseUrl();
    const needsSsl = /neon\.tech|supabase\.|render\.com|amazonaws\.com|sslmode=require/.test(
      env.databaseUrl,
    );
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: env.isTest ? 20 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error', err);
    });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Run `fn` inside a transaction on a dedicated client.
 *
 * Note what this is and is not for: it gives atomicity, not slot safety. The
 * no-double-booking guarantee comes from the exclusion constraint in the
 * schema and holds regardless of isolation level; this helper only ensures a
 * reschedule's "release old + take new" pair either both land or neither does.
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken; nothing useful to do */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

// Postgres SQLSTATEs we translate into domain errors.
export const PG_ERRORS = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
};
