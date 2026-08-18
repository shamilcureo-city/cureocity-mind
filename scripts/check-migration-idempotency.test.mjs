import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-migration-idempotency.mjs');
const orbitDir = '20260908000000_orbit_sprint2_capabilities';
const fixtures = [];

function makeFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'migration-guard-'));
  fixtures.push(fixture);
  mkdirSync(join(fixture, 'prisma', 'migrations'), { recursive: true });
  return fixture;
}

function runChecker(cwd) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

test('fails closed when the required ORBIT migration directory is missing', () => {
  const result = runChecker(makeFixture());

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${orbitDir}: required migration directory is missing`));
});

test('fails closed when the required ORBIT migration file is missing', () => {
  const fixture = makeFixture();
  mkdirSync(join(fixture, 'prisma', 'migrations', orbitDir));

  const result = runChecker(fixture);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`${orbitDir}/migration\\.sql: required migration file is missing`),
  );
});

test('checks security evidence in the authoritative ORBIT migration', () => {
  const fixture = makeFixture();
  const orbitPath = join(fixture, 'prisma', 'migrations', orbitDir);
  mkdirSync(orbitPath);
  writeFileSync(join(orbitPath, 'migration.sql'), 'SELECT 1;\n');

  const result = runChecker(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must store trimmed nonblank RCI registrations/);
});
