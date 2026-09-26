import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('coding migration source checks (not database execution)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), '../../prisma/migrations/20260930000000_scribe_coding/migration.sql'),
    'utf8',
  );
  it('retains existing record kinds and adds one coding worksheet per encounter', () => {
    for (const kind of [
      'shortcut',
      'note_style',
      'intake',
      'task',
      'report',
      'instructions',
      'teleconsult',
      'coding',
    ])
      expect(sql).toContain(`'${kind}'`);
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "scribe_workspace_one_coding_per_session"',
    );
    expect(sql).toContain('ON "scribe_workspace_records" ("sessionId") WHERE "kind" = \'coding\'');
    expect(sql).toContain(
      '"kind" IN (\'teleconsult\', \'coding\') AND "clientId" IS NOT NULL AND "sessionId" IS NOT NULL',
    );
  });
  it('bounds lock time and does not rewrite patient data or clinical signatures', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+"|therapy_notes/i);
  });
});
