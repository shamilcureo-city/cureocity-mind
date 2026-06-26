#!/usr/bin/env node
/**
 * Guards the migration idempotency convention (S58–S69 review finding #1).
 *
 * Every NEW migration's DDL must be safe to REPLAY, because the P3009
 * rollback-and-retry self-heal in scripts/vercel-db-setup.sh re-runs a
 * migration's SQL after marking it rolled back. A bare `CREATE TABLE` /
 * `CREATE TYPE` then fails with "already exists" and wedges every deploy —
 * the exact incident that froze prod for 18h on 2026-06-20.
 *
 * Enforced (for migrations dated on/after CUTOFF):
 *   - CREATE TABLE            → CREATE TABLE IF NOT EXISTS
 *   - CREATE [UNIQUE] INDEX   → ... IF NOT EXISTS
 *   - ALTER TABLE … ADD COLUMN→ ADD COLUMN IF NOT EXISTS
 *   - ALTER TYPE … ADD VALUE  → ADD VALUE IF NOT EXISTS
 *   - CREATE TYPE             → wrapped in a
 *                               DO $$ … EXCEPTION WHEN duplicate_object … $$ block
 *
 * Migrations BEFORE the cutoff are grandfathered: they are already applied
 * to prod and MUST NOT be edited — that would change their Prisma checksum
 * and trip drift detection. New migrations always get a later timestamp, so
 * they fall under enforcement automatically.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'prisma/migrations';
// Enforced from the review-followups migration onward. Everything earlier
// (incl. the un-guarded S66/S67c/S68 migrations) is already applied and
// grandfathered. Do NOT lower this to "fix" an applied migration.
const CUTOFF = '20260729000000';

/** @type {string[]} */
const problems = [];

for (const dir of readdirSync(MIGRATIONS_DIR).sort()) {
  const match = dir.match(/^(\d{14})_/);
  if (!match) continue;
  if (match[1] < CUTOFF) continue; // grandfathered — already applied to prod
  const file = join(MIGRATIONS_DIR, dir, 'migration.sql');
  if (!existsSync(file)) continue;

  // Strip line comments so a comment mentioning "CREATE TABLE" can't trip us.
  const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');

  if (/\bCREATE TABLE\b(?!\s+IF NOT EXISTS)/i.test(sql)) {
    problems.push(`${dir}: CREATE TABLE without "IF NOT EXISTS"`);
  }
  if (/\bCREATE(?:\s+UNIQUE)?\s+INDEX\b(?!\s+IF NOT EXISTS)/i.test(sql)) {
    problems.push(`${dir}: CREATE INDEX without "IF NOT EXISTS"`);
  }
  if (/\bADD COLUMN\b(?!\s+IF NOT EXISTS)/i.test(sql)) {
    problems.push(`${dir}: ADD COLUMN without "IF NOT EXISTS"`);
  }
  if (/\bADD VALUE\b(?!\s+IF NOT EXISTS)/i.test(sql)) {
    problems.push(`${dir}: ALTER TYPE … ADD VALUE without "IF NOT EXISTS"`);
  }
  // A guarded CREATE TYPE lives inside a DO $$ … $$ block; strip those, then
  // any remaining CREATE TYPE is unguarded.
  const withoutDoBlocks = sql.replace(/DO \$\$[\s\S]*?\$\$\s*;/gi, '');
  if (/\bCREATE TYPE\b/i.test(withoutDoBlocks)) {
    problems.push(
      `${dir}: CREATE TYPE not wrapped in a DO $$ … EXCEPTION WHEN duplicate_object … $$ block`,
    );
  }
}

if (problems.length > 0) {
  console.error('✖ Non-idempotent migration DDL (must be replay-safe):\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(
    '\nGuard new DDL so the P3009 self-heal can replay it:\n' +
      '  • CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS\n' +
      '  • ALTER TYPE … ADD VALUE IF NOT EXISTS (for new enum values)\n' +
      '  • CREATE TYPE inside:\n' +
      '      DO $$ BEGIN CREATE TYPE "Foo" AS ENUM (...);\n' +
      '      EXCEPTION WHEN duplicate_object THEN null; END $$;\n' +
      '\nSee CLAUDE.md §4. Do NOT edit an already-applied migration (checksum drift) —\n' +
      'fix it forward in a new, guarded migration.',
  );
  process.exit(1);
}

console.log(`✓ Migrations on/after ${CUTOFF} use idempotent (replay-safe) DDL.`);
