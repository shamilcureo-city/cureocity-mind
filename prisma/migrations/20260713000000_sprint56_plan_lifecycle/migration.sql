-- Sprint 56 (Lever 4 #4) — self-serve plan pause/resume/cancel.
--
-- New BillingAccountStatus enum + three columns on billing_accounts,
-- plus the lifecycle audit verbs. All idempotent.

DO $$ BEGIN
  CREATE TYPE "BillingAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "billing_accounts"
  ADD COLUMN IF NOT EXISTS "status" "BillingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "pausedRemainingDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_RESUMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_CANCELLED';
