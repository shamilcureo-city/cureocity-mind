import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../../..');
const prismaRoot = join(repoRoot, 'prisma');
const originalMigrationPath = join(
  prismaRoot,
  'migrations/20260922000000_explicit_homework/migration.sql',
);
const followUpMigrationPath = join(
  prismaRoot,
  'migrations/20260925000000_claim_token_supersession/migration.sql',
);
const read = (path: string) => readFileSync(path, 'utf8');
const followUpSql = () => (existsSync(followUpMigrationPath) ? read(followUpMigrationPath) : '');

describe('R2-09 claim-token supersession persistence', () => {
  it('models supersession separately from true redemption in Prisma and contracts', () => {
    const schema = read(join(prismaRoot, 'schema.prisma'));
    const contracts = read(join(repoRoot, 'packages/contracts/src/client.ts'));

    expect(schema).toMatch(/supersededAt\s+DateTime\?/);
    expect(schema).toContain('@@index([clientId, redeemedAt, supersededAt])');
    expect(contracts).toContain('superseded: z.boolean()');
  });

  it('makes the original unshipped migration supersede duplicate active tokens without fake redemption', () => {
    const sql = read(originalMigrationPath);

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3)');
    expect(sql).toMatch(
      /UPDATE "client_claim_tokens" AS token\s+SET "supersededAt" = NOW\(\)[\s\S]+WHERE token\."id" = ranked\."id" AND ranked\.rn > 1/,
    );
    expect(sql).not.toMatch(/SET "redeemedAt" = NOW\(\)[\s\S]+ranked\.rn > 1/);
    expect(sql).toContain('WHERE "redeemedAt" IS NULL AND "supersededAt" IS NULL');
  });

  it('fixes forward historical fake redemptions while preserving true redemptions', () => {
    const sql = followUpSql();

    expect(sql).toMatch(
      /UPDATE "client_claim_tokens"\s+SET "supersededAt" = "redeemedAt",\s+"redeemedAt" = NULL\s+WHERE "redeemedAt" IS NOT NULL\s+AND "redeemedByFirebaseUid" IS NULL/,
    );
    expect(sql).not.toMatch(
      /WHERE "redeemedAt" IS NOT NULL\s*;(?![\s\S]*"redeemedByFirebaseUid" IS NULL)/,
    );
    expect(sql).toContain('WHERE "redeemedAt" IS NULL AND "supersededAt" IS NULL');
  });

  it('is replay-safe whether or not the original migration ran and scopes catalog checks to the target relation', () => {
    const sql = followUpSql();

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3)');
    expect(sql).toContain('DROP INDEX IF EXISTS "client_claim_tokens_one_unredeemed_per_client"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(sql).toContain('FROM pg_constraint AS catalog_constraint');
    expect(sql).toContain("catalog_constraint.conrelid = 'client_claim_tokens'::regclass");
    expect(sql).toContain('schema.nspname = current_schema()');
  });

  it('enforces mutually exclusive, internally complete terminal states', () => {
    const sql = followUpSql();

    expect(sql).toMatch(
      /CHECK \(\s*\("redeemedAt" IS NULL\) = \("redeemedByFirebaseUid" IS NULL\)[\s\S]+NOT \("redeemedAt" IS NOT NULL AND "supersededAt" IS NOT NULL\)/,
    );
  });
});
