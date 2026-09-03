#!/usr/bin/env node
/**
 * A real Postgres, locally, with nothing installed.
 *
 * `embedded-postgres` unpacks genuine Postgres binaries (including the
 * btree_gist contrib module this project's exclusion constraint depends on)
 * into node_modules and runs them against a data directory in .localdb/.
 *
 * This exists so the project can be run and its concurrency suite executed on
 * a machine with no Postgres, no Docker and no cloud credentials. For anything
 * beyond local development, point DATABASE_URL at a managed Postgres instead -
 * nothing else in the codebase knows or cares which one it is talking to.
 *
 *   node scripts/localdb.js start   # start, create databases, stay running
 *   node scripts/localdb.js init    # start, create databases, exit (leaves it up)
 *   node scripts/localdb.js stop    # stop the cluster
 */
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(SERVER_ROOT, '.localdb');

export const LOCAL_DB = {
  host: '127.0.0.1',
  port: 55432,
  user: 'postgres',
  password: 'postgres',
  databases: ['booking', 'booking_test'],
};

export const urlFor = (database) =>
  `postgresql://${LOCAL_DB.user}:${LOCAL_DB.password}@${LOCAL_DB.host}:${LOCAL_DB.port}/${database}`;

function instance() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: LOCAL_DB.user,
    password: LOCAL_DB.password,
    port: LOCAL_DB.port,
    persistent: true,
    // The cluster is a dev fixture, not a durable store: skipping the fsync
    // barrier makes the test suite's several hundred transactions run in
    // seconds rather than minutes.
    postgresFlags: ['-c', 'fsync=off', '-c', 'synchronous_commit=off'],
  });
}

async function ensureDatabases(pg) {
  const client = pg.getPgClient('postgres');
  await client.connect();
  try {
    for (const name of LOCAL_DB.databases) {
      const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (rows.length === 0) {
        await client.query(`CREATE DATABASE ${name}`);
        console.log(`[localdb] created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function boot() {
  const pg = instance();
  const fresh = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (fresh) {
    console.log('[localdb] initialising a new cluster in server/.localdb');
    await pg.initialise();
  }
  await pg.start();
  console.log(`[localdb] Postgres listening on ${LOCAL_DB.host}:${LOCAL_DB.port}`);
  await ensureDatabases(pg);
  for (const name of LOCAL_DB.databases) console.log(`[localdb]   ${urlFor(name)}`);
  return pg;
}

const cmd = process.argv[2] ?? 'start';

if (cmd === 'stop') {
  await instance().stop();
  console.log('[localdb] stopped');
} else {
  const pg = await boot();
  if (cmd === 'init') {
    // Leave the cluster running for other processes and let this one exit.
    console.log('[localdb] ready');
    process.exit(0);
  }
  const shutdown = async () => {
    console.log('\n[localdb] stopping');
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Hold the process open so `npm run db:local` behaves like a server.
  setInterval(() => {}, 1 << 30);
}
