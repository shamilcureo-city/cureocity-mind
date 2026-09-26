import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('teleconsult additive storage and privacy wiring (source checks, not database execution)', () => {
  it('replaces only replay-safe constraints and adds a conditional unique encounter index', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        '../../prisma/migrations/20260929000000_scribe_teleconsult/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "scribe_workspace_kind"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "scribe_workspace_scope"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(sql).toContain(
      '"kind" = \'teleconsult\' AND "clientId" IS NOT NULL AND "sessionId" IS NOT NULL',
    );
    expect(sql).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+"/i);
    for (const kind of ['shortcut', 'note_style', 'intake', 'task', 'report', 'instructions'])
      expect(sql).toContain(`'${kind}'`);
  });
  it('keeps erasure independent of feature flags and record kind', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/dpdp-erasure.ts'), 'utf8');
    expect(source).toContain('tx.scribeWorkspaceRecord.deleteMany({ where: { clientId } })');
    expect(source).not.toContain('SCRIBE_TELECONSULT_ENABLED');
  });
});
