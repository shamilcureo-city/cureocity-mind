import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260926001200_session_usage_connections/migration.sql',
  ),
  'utf8',
);
describe('session usage migration static safety (not database execution)', () => {
  it('is additive, replay safe, and bounds lock/statement duration', () => {
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '60s'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "session_usage_connections"');
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'SESSION_USAGE_REGISTERED'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'SESSION_USAGE_REPORTED'");
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)|\bUPDATE\s+"(?:clients|sessions)"/);
  });
  it('keeps usage null before receipt and guards canonical receipt ownership and totals', () => {
    expect(sql).toContain('"lastSequence" = 0');
    expect(sql).toContain('"costInr" IS NULL');
    expect(sql).toContain('"lastPayloadHash" IS NOT NULL');
    expect(sql).toContain('"lastReceipt"->>\'connectionId\' = "connectionId"::text');
    expect(sql).toContain(') IS TRUE');
    expect(sql).toContain('"endedAt" IS NOT NULL');
  });
  it('guards client identity and monotonic receipts alongside application Client locks', () => {
    expect(sql).toContain('s."clientId" = NEW."clientId"');
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('NEW."lastSequence" <= OLD."lastSequence"');
    expect(sql).toContain('Usage counters cannot decrease.');
    expect(sql).toContain('Usage connection identity is immutable.');
    expect(sql).toContain('Metered visit ownership cannot be reassigned.');
  });
});
