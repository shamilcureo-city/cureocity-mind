-- S58–S69 review follow-ups.
-- Every statement is guarded/idempotent (IF NOT EXISTS) so a re-run — or the
-- P3009 rollback-and-retry in scripts/vercel-db-setup.sh — is always safe, per
-- the per-sprint migration convention.

-- 1. Index the problem-list query: the client page lists items ordered by
--    createdAt desc per client, which the existing (clientId, status) index
--    can't serve.
CREATE INDEX IF NOT EXISTS "problem_list_items_clientId_createdAt_idx"
  ON "problem_list_items"("clientId", "createdAt");

-- 2. Durable first-run welcome flag — a per-therapist column replacing the
--    per-device localStorage flag, plus the audit action for its dismissal.
ALTER TABLE "psychologists" ADD COLUMN IF NOT EXISTS "hasSeenWelcome" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WELCOME_DISMISSED';
