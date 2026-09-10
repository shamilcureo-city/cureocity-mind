import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { INDEX_NAME_CUTOFF, overlongMigrationIndexNames } from './migration-index-names.mjs';

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

const indexSql = (name) => `CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON example (id);`;

test('accepts 63 ASCII bytes and rejects 64 at the new cutoff', () => {
  assert.deepEqual(overlongMigrationIndexNames(indexSql('a'.repeat(63)), INDEX_NAME_CUTOFF), []);
  assert.deepEqual(overlongMigrationIndexNames(indexSql('a'.repeat(64)), INDEX_NAME_CUTOFF), [
    { name: 'a'.repeat(64), bytes: 64 },
  ]);
});

test('counts decoded UTF-8 bytes, not characters or JavaScript string length', () => {
  assert.deepEqual(overlongMigrationIndexNames(indexSql('界'.repeat(21)), INDEX_NAME_CUTOFF), []);
  assert.deepEqual(overlongMigrationIndexNames(indexSql('é'.repeat(32)), INDEX_NAME_CUTOFF), [
    { name: 'é'.repeat(32), bytes: 64 },
  ]);
  assert.deepEqual(overlongMigrationIndexNames(indexSql('😀'.repeat(16)), INDEX_NAME_CUTOFF), [
    { name: '😀'.repeat(16), bytes: 64 },
  ]);
});

test('decodes doubled quotes before applying the byte limit', () => {
  assert.deepEqual(
    overlongMigrationIndexNames(indexSql(`${'a'.repeat(61)}""b`), INDEX_NAME_CUTOFF),
    [],
  );
  assert.deepEqual(
    overlongMigrationIndexNames(indexSql(`${'a'.repeat(62)}""b`), INDEX_NAME_CUTOFF),
    [{ name: `${'a'.repeat(62)}"b`, bytes: 64 }],
  );
});

test('supports plain, quoted, mixed-case, commented and concurrent CREATE INDEX', () => {
  const sql = `
    CREATE INDEX IF NOT EXISTS short_name ON example (id);
    create unique /* comment */ index concurrently if not exists "Short name" ON example (id);
    CREATE INDEX "${'z'.repeat(64)}" ON example (id);
  `;
  assert.deepEqual(overlongMigrationIndexNames(sql, INDEX_NAME_CUTOFF), [
    { name: 'z'.repeat(64), bytes: 64 },
  ]);
});

test('decodes Unicode-escaped quoted names, including explicit UESCAPE', () => {
  assert.deepEqual(
    overlongMigrationIndexNames(
      `CREATE UNIQUE INDEX IF NOT EXISTS U&"${'\\0061'.repeat(63)}" ON example (id);`,
      INDEX_NAME_CUTOFF,
    ),
    [],
  );
  assert.deepEqual(
    overlongMigrationIndexNames(
      `CREATE UNIQUE INDEX IF NOT EXISTS U&"${'\\+01F600'.repeat(16)}" ON example (id);`,
      INDEX_NAME_CUTOFF,
    ),
    [{ name: '😀'.repeat(16), bytes: 64 }],
  );
  assert.deepEqual(
    overlongMigrationIndexNames(
      `CREATE UNIQUE INDEX IF NOT EXISTS U&"${'!0061'.repeat(62)}!!b" UESCAPE '!' ON example (id);`,
      INDEX_NAME_CUTOFF,
    ),
    [{ name: `${'a'.repeat(62)}!b`, bytes: 64 }],
  );
});

test('ignores comments and string literals without corrupting quoted identifier content', () => {
  const long = indexSql('x'.repeat(64));
  const sql = `-- ${long}\n/* nested /* ${long} */ ${long} */\nSELECT '${long}';\n${indexSql('-- short /* name */')}`;
  assert.deepEqual(overlongMigrationIndexNames(sql, INDEX_NAME_CUTOFF), []);
});

test('checks literal DDL inside dollar-quoted DO blocks', () => {
  assert.equal(
    overlongMigrationIndexNames(
      `DO $$ BEGIN ${indexSql('a'.repeat(64))} END $$;`,
      INDEX_NAME_CUTOFF,
    ).length,
    1,
  );
});

test('apostrophes in untagged and tagged dollar strings cannot swallow later DDL', () => {
  for (const delimiter of ['$$', '$message$']) {
    assert.deepEqual(
      overlongMigrationIndexNames(
        `SELECT ${delimiter}don't${delimiter}; ${indexSql('x'.repeat(64))}`,
        INDEX_NAME_CUTOFF,
      ),
      [{ name: 'x'.repeat(64), bytes: 64 }],
    );
  }
});

test('DDL-looking content in dollar strings is not an index declaration', () => {
  for (const delimiter of ['$$', '$message$']) {
    assert.deepEqual(
      overlongMigrationIndexNames(
        `SELECT ${delimiter}${indexSql('x'.repeat(64))} don't${delimiter};`,
        INDEX_NAME_CUTOFF,
      ),
      [],
    );
  }
});

test('scans tagged DO bodies and keeps their nested dollar literals atomic', () => {
  for (const prefix of ['DO', 'DO LANGUAGE plpgsql', 'DO LANGUAGE "plpgsql"']) {
    assert.deepEqual(
      overlongMigrationIndexNames(
        `${prefix} $body$ BEGIN
           RAISE NOTICE $message$don't ${indexSql('y'.repeat(64))}$message$;
           ${indexSql('x'.repeat(64))}
         END $body$;`,
        INDEX_NAME_CUTOFF,
      ),
      [{ name: 'x'.repeat(64), bytes: 64 }],
    );
  }
});

test('leaves function bodies to review but resumes checking subsequent DDL', () => {
  assert.deepEqual(
    overlongMigrationIndexNames(
      `CREATE FUNCTION example() RETURNS void AS $body$
         BEGIN ${indexSql('y'.repeat(64))} RAISE NOTICE 'done'; END
       $body$ LANGUAGE plpgsql;
       ${indexSql('x'.repeat(64))}`,
      INDEX_NAME_CUTOFF,
    ),
    [{ name: 'x'.repeat(64), bytes: 64 }],
  );
});

test('does not reject grandfathered historical index names', () => {
  assert.deepEqual(overlongMigrationIndexNames(indexSql('a'.repeat(100)), '20260926000599'), []);
});

test('existing check command enforces the new rule only from the cutoff onward', () => {
  const fixture = makeFixture();
  const orbitPath = join(fixture, 'prisma', 'migrations', orbitDir);
  mkdirSync(orbitPath);
  writeFileSync(
    join(orbitPath, 'migration.sql'),
    readFileSync(join(dirname(script), '..', 'prisma', 'migrations', orbitDir, 'migration.sql')),
  );
  const historical = join(fixture, 'prisma', 'migrations', '20260926000599_historical');
  mkdirSync(historical);
  writeFileSync(join(historical, 'migration.sql'), indexSql('a'.repeat(100)));
  assert.equal(runChecker(fixture).status, 0);

  const future = join(fixture, 'prisma', 'migrations', `${INDEX_NAME_CUTOFF}_new_index`);
  mkdirSync(future);
  writeFileSync(join(future, 'migration.sql'), indexSql('a'.repeat(64)));
  const result = runChecker(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /64 UTF-8 bytes \(PostgreSQL limit: 63\)/);
});
