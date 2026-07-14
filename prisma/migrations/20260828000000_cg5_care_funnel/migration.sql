-- CG5 — Care funnel: session pack + 7-day no-card trial (docs/CARE_GROWTH_SYSTEM.md §7/§12).
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "plusTrialStartedAt" TIMESTAMP(3);
ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "plusTrialEndsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "care_session_credits" (
    "id" TEXT NOT NULL,
    "careUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedBySessionId" TEXT,

    CONSTRAINT "care_session_credits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "care_session_credits_careUserId_expiresAt_idx" ON "care_session_credits"("careUserId", "expiresAt");
DO $$ BEGIN
  ALTER TABLE "care_session_credits" ADD CONSTRAINT "care_session_credits_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SESSION_PACK_PURCHASED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_TRIAL_STARTED';
