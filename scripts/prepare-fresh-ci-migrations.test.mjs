import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { assertSafeFreshCiDatabase } from './prepare-fresh-ci-migrations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repairMigration = join(
  root,
  'prisma',
  'migrations',
  '20260921000000_reconcile_ja_booking_seams',
  'migration.sql',
);

const safeEnv = {
  CI: 'true',
  RUN_INTEGRATION_TESTS: '1',
  DATABASE_URL: 'postgresql://cureocity:secret@localhost:5432/cureocity_mind_test',
};

test('allows only the disposable GitHub integration database', () => {
  assert.doesNotThrow(() => assertSafeFreshCiDatabase(safeEnv));
});

test('rejects a non-local database host', () => {
  assert.throws(
    () =>
      assertSafeFreshCiDatabase({
        ...safeEnv,
        DATABASE_URL: 'postgresql://cureocity:secret@production.example/cureocity_mind_test',
      }),
    /local disposable database/,
  );
});

test('rejects a database name other than the dedicated test database', () => {
  assert.throws(
    () =>
      assertSafeFreshCiDatabase({
        ...safeEnv,
        DATABASE_URL: 'postgresql://cureocity:secret@localhost:5432/cureocity',
      }),
    /cureocity_mind_test/,
  );
});

test('rejects execution outside the integration-test CI job', () => {
  assert.throws(
    () => assertSafeFreshCiDatabase({ ...safeEnv, CI: 'false' }),
    /CI integration tests/,
  );
  assert.throws(
    () => assertSafeFreshCiDatabase({ ...safeEnv, RUN_INTEGRATION_TESTS: '0' }),
    /CI integration tests/,
  );
});

test('fix-forward migration restores both indexes skipped by the historical migration', () => {
  const sql = readFileSync(repairMigration, 'utf8');

  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_psychologistId_startAt_active_key"/,
  );
  assert.match(sql, /ON "Appointment" \("psychologistId", "startAt"\)/);
  assert.match(
    sql,
    /WHERE "status" IN \('REQUESTED'::"AppointmentStatus", 'CONFIRMED'::"AppointmentStatus"\)/,
  );
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "clients_psychologistId_demo_key"/);
  assert.match(sql, /ON "clients" \("psychologistId"\)/);
  assert.match(sql, /WHERE "isDemo" = true/);
});
