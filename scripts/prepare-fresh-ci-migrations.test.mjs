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

test('preserves both existing Mind disposable targets without Scribe opt-in', () => {
  for (const target of [
    'postgresql://cureocity:secret@localhost:5432/cureocity_mind_test',
    'postgresql://cureocity:secret@127.0.0.1:55439/cureocity_mind_test',
  ]) {
    assert.doesNotThrow(() => assertSafeFreshCiDatabase({ ...safeEnv, DATABASE_URL: target }));
  }
});

const scribeEnv = {
  ...safeEnv,
  RUN_SCRIBE_POSTGRES_TESTS: '1',
  DATABASE_URL:
    'postgresql://scribe_test_owner:scribe_ci_owner@127.0.0.1:55440/cureocity_scribe_test',
};

test('allows the separate exact Scribe fixture only with all three CI opt-ins', () => {
  assert.doesNotThrow(() => assertSafeFreshCiDatabase(scribeEnv));
  assert.doesNotThrow(() =>
    assertSafeFreshCiDatabase({
      ...scribeEnv,
      DATABASE_URL: scribeEnv.DATABASE_URL.replace('postgresql:', 'postgres:'),
    }),
  );
  for (const key of ['CI', 'RUN_INTEGRATION_TESTS', 'RUN_SCRIBE_POSTGRES_TESTS']) {
    for (const value of [undefined, '', '0', 'false']) {
      assert.throws(() => assertSafeFreshCiDatabase({ ...scribeEnv, [key]: value }));
    }
  }
});

test('Scribe opt-in cannot fall back to either legacy Mind target', () => {
  for (const DATABASE_URL of [
    safeEnv.DATABASE_URL,
    'postgresql://cureocity:secret@127.0.0.1:55439/cureocity_mind_test',
  ]) {
    assert.throws(() => assertSafeFreshCiDatabase({ ...scribeEnv, DATABASE_URL }));
  }
});

test('rejects alternate Scribe protocols, hosts, ports and database paths', () => {
  for (const DATABASE_URL of [
    'https://scribe_test_owner:fixture@127.0.0.1:55440/cureocity_scribe_test',
    'mysql://scribe_test_owner:fixture@127.0.0.1:55440/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@localhost:55440/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@production.invalid:55440/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@[::1]:55440/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@127.0.0.1:5432/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@127.0.0.1/cureocity_scribe_test',
    'postgresql://scribe_test_owner:fixture@127.0.0.1:55440/cureocity',
    `${scribeEnv.DATABASE_URL}/`,
    scribeEnv.DATABASE_URL.replace('cureocity_scribe_test', 'cureocity%5Fscribe_test'),
    'not-a-url',
    undefined,
  ]) {
    assert.throws(() => assertSafeFreshCiDatabase({ ...scribeEnv, DATABASE_URL }));
  }
});

test('rejects every Scribe query or fragment that could change the reviewed connection', () => {
  for (const suffix of [
    '?host=production.invalid',
    '?port=5432',
    '?dbname=production',
    '?schema=elsewhere',
    '?options=-csearch_path%3Delsewhere',
    '?user=owner',
    '?sslmode=disable',
    '#other-target',
  ]) {
    assert.throws(() =>
      assertSafeFreshCiDatabase({ ...scribeEnv, DATABASE_URL: scribeEnv.DATABASE_URL + suffix }),
    );
  }
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
