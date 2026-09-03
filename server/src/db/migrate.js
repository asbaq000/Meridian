#!/usr/bin/env node
/**
 * Tiny forward-only migration runner.
 *
 * Each .sql file in ./migrations runs once, in filename order, inside its own
 * transaction, and is recorded in schema_migrations. No down-migrations: for a
 * project this size `migrate:reset` is honest and a rollback path is not.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './index.js';
import { env } from '../config/env.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureRegistry(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrations() {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

export async function migrateUp({ silent = false } = {}) {
  const client = await getPool().connect();
  const log = silent ? () => {} : (...a) => console.log(...a);
  try {
    await ensureRegistry(client);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = await listMigrations();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      log('[migrate] nothing to do, schema is current');
      return [];
    }

    for (const file of pending) {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`[migrate] applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
    log(`[migrate] applied ${pending.length} migration(s)`);
    return pending;
  } finally {
    client.release();
  }
}

/** Drop and rebuild the public schema. Used by `migrate:reset` and by tests. */
export async function migrateReset({ silent = false } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    client.release();
  }
  return migrateUp({ silent });
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCli) {
  const cmd = process.argv[2] ?? 'up';
  try {
    const target = env.databaseUrl?.replace(/:[^:@/]*@/, ':****@') ?? '(unset)';
    console.log(`[migrate] target ${target}`);
    if (cmd === 'reset') {
      console.log('[migrate] dropping schema public');
      await migrateReset();
    } else {
      await migrateUp();
    }
  } catch (err) {
    console.error(`[migrate] ${err.message}`);
    if (err.cause?.hint) console.error(`[migrate] hint: ${err.cause.hint}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
