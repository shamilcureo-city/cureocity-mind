#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const HISTORICAL_MIGRATION = '20260811093000_ja_booking_seams';

export function assertSafeFreshCiDatabase(env) {
  if (env.CI !== 'true' || env.RUN_INTEGRATION_TESTS !== '1') {
    throw new Error('Historical migration reconciliation is restricted to CI integration tests');
  }

  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Historical migration reconciliation requires a local disposable database');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0]);
  // The Scribe fixture is a separate, explicitly opted-in CI database. Do not
  // widen the legacy Mind target or allow connection parameters to override
  // this fixture's host, port, database, or schema.
  if (env.RUN_SCRIBE_POSTGRES_TESTS === '1' || database === 'cureocity_scribe_test') {
    if (
      env.RUN_SCRIBE_POSTGRES_TESTS !== '1' ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '55440' ||
      url.pathname !== '/cureocity_scribe_test' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Scribe reconciliation requires its explicit CI opt-in and exact local disposable target 127.0.0.1:55440/cureocity_scribe_test without connection overrides',
      );
    }
    return;
  }
  if (database !== 'cureocity_mind_test') {
    throw new Error('Historical migration reconciliation requires cureocity_mind_test');
  }
}

export function prepareFreshCiMigrations(env = process.env) {
  assertSafeFreshCiDatabase(env);
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'resolve', '--applied', HISTORICAL_MIGRATION],
    { env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed to reconcile ${HISTORICAL_MIGRATION}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  prepareFreshCiMigrations();
}
