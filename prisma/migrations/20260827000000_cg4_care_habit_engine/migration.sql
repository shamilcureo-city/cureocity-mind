-- CG4 — Care habit engine + WhatsApp utility channel (docs/CARE_GROWTH_SYSTEM.md §6/§12).
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

-- Consent is an explicit in-app tap, timestamped (TRAI DCA). Null = never send.
ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "whatsappOptInAt" TIMESTAMP(3);
ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "nudgePrefs" JSONB;

-- One row per nudge DECISION — SUPPRESSED rows prove the negative.
CREATE TABLE IF NOT EXISTS "care_nudges" (
    "id" TEXT NOT NULL,
    "careUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "providerMessageId" TEXT,
    "istDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_nudges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "care_nudges_careUserId_kind_istDay_key" ON "care_nudges"("careUserId", "kind", "istDay");
CREATE INDEX IF NOT EXISTS "care_nudges_careUserId_createdAt_idx" ON "care_nudges"("careUserId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "care_nudges" ADD CONSTRAINT "care_nudges_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Homework ticks: one tap per IST day.
CREATE TABLE IF NOT EXISTS "care_homework_ticks" (
    "id" TEXT NOT NULL,
    "careUserId" TEXT NOT NULL,
    "istDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_homework_ticks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "care_homework_ticks_careUserId_istDay_key" ON "care_homework_ticks"("careUserId", "istDay");
DO $$ BEGIN
  ALTER TABLE "care_homework_ticks" ADD CONSTRAINT "care_homework_ticks_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Habit-engine audit actions (literal writers per the chaos-test rule).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_NUDGE_OPTIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_NUDGE_OPTOUT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_NUDGE_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_NUDGE_SUPPRESSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_HOMEWORK_TICKED';
