import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260926001100_mind_session_preparation/migration.sql',
  ),
  'utf8',
);
describe('preparation migration static safety checks (not database execution)', () => {
  it('is additive, bounded and replay-safe', () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "mind_session_preparations"');
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'MIND_SESSION_PREPARATION_SAVED'");
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)|\bUPDATE\s+"(?:clients|sessions)"/);
    expect(sql).toContain('COMMIT;');
  });
  it('guards unique retry identities, positive revisions and append-only updates', () => {
    expect(sql).toContain('CHECK ("revision" > 0)');
    expect(sql).toContain('("sessionId", "revision")');
    expect(sql).toContain('("sessionId", "operationId")');
    expect(sql).toContain('BEFORE UPDATE ON "mind_session_preparations"');
    expect(sql).toContain('Preparation revisions are immutable.');
  });
  it('checks both visit and active-client tenant ownership', () => {
    expect(sql).toContain('JOIN "clients" c ON c."id" = s."clientId"');
    expect(sql).toContain('s."psychologistId" = NEW."psychologistId"');
    expect(sql).toContain('c."psychologistId" = NEW."psychologistId"');
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('REFERENCES "sessions"("id") ON DELETE CASCADE');
    expect(sql).toContain('BEFORE UPDATE OF "clientId", "psychologistId" ON "sessions"');
    expect(sql).toContain('Prepared visit ownership cannot be reassigned.');
  });
});
