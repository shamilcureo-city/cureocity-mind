-- Sprints AC1-AC5 — Cureocity Care, the standalone D2C AI-therapist product.
-- Self-owned CareUser identity + versioned CarePlan + kind-branched
-- CareSession/CareReport + check-ins + self-administered instruments.
-- See docs/AI_COUNSELING.md §7, docs/AI_COUNSELING_SPRINTS.md.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CareUserStatus" AS ENUM ('ACTIVE', 'SAFETY_HOLD', 'DELETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CareSessionKind" AS ENUM ('INTAKE', 'TREATMENT', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CareSessionStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED', 'CRISIS_ESCALATED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CareRiskLevel" AS ENUM ('NONE', 'LOW', 'MODERATE', 'HIGH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Append-only enum values (idempotent re-runs)
ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_13_CARE_REPORT';
ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'LIVE_CARE_SESSION';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_USER_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ONBOARDING_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_CONSENT_CAPTURED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SESSION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SESSION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SESSION_ABORTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_PLAN_PROPOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_PLAN_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_PLAN_REVISED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_INSTRUMENT_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_CRISIS_ESCALATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SAFETY_HOLD_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_SAFETY_HOLD_LIFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_REPORT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_CHECKIN_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ACCOUNT_DELETED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "care_users" (
  "id" TEXT NOT NULL,
  "firebaseUid" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "phone" TEXT,
  "phoneEncrypted" TEXT,
  "email" TEXT,
  "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
  "spokenLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "personaName" TEXT NOT NULL DEFAULT 'Meera',
  "voiceName" TEXT NOT NULL DEFAULT 'Kore',
  "personaStyle" TEXT NOT NULL DEFAULT 'gentle',
  "vadSilenceMs" INTEGER NOT NULL DEFAULT 700,
  "trustedContactName" TEXT,
  "trustedContactPhone" TEXT,
  "status" "CareUserStatus" NOT NULL DEFAULT 'ACTIVE',
  "safetyHoldAt" TIMESTAMP(3),
  "planTier" TEXT NOT NULL DEFAULT 'free',
  "onboardedAt" TIMESTAMP(3),
  "consentVersion" TEXT,
  "consentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "care_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_plans" (
  "id" TEXT NOT NULL,
  "careUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "formulation" JSONB NOT NULL,
  "goals" JSONB NOT NULL,
  "modalityTrack" TEXT NOT NULL,
  "cadence" TEXT NOT NULL DEFAULT 'weekly-25min',
  "sourceSessionId" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "care_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_sessions" (
  "id" TEXT NOT NULL,
  "careUserId" TEXT NOT NULL,
  "kind" "CareSessionKind" NOT NULL,
  "carePlanId" TEXT,
  "status" "CareSessionStatus" NOT NULL DEFAULT 'CREATED',
  "topic" TEXT,
  "moodBefore" INTEGER,
  "moodAfter" INTEGER,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSec" INTEGER,
  "liveTranscript" JSONB NOT NULL DEFAULT '[]',
  "liveTranscriptEncrypted" TEXT,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "crisisAt" TIMESTAMP(3),
  "crisisSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_reports" (
  "id" TEXT NOT NULL,
  "careSessionId" TEXT NOT NULL,
  "kind" "CareSessionKind" NOT NULL,
  "body" JSONB NOT NULL,
  "riskLevel" "CareRiskLevel" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "care_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_checkins" (
  "id" TEXT NOT NULL,
  "careUserId" TEXT NOT NULL,
  "mood" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "care_checkins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "care_instrument_responses" (
  "id" TEXT NOT NULL,
  "careUserId" TEXT NOT NULL,
  "instrumentKey" TEXT NOT NULL,
  "answers" JSONB NOT NULL,
  "totalScore" INTEGER NOT NULL,
  "item9" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "care_instrument_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "care_users_firebaseUid_key" ON "care_users"("firebaseUid");
CREATE INDEX IF NOT EXISTS "care_users_status_idx" ON "care_users"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "care_plans_careUserId_version_key" ON "care_plans"("careUserId", "version");
CREATE INDEX IF NOT EXISTS "care_sessions_careUserId_createdAt_idx" ON "care_sessions"("careUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "care_sessions_status_createdAt_idx" ON "care_sessions"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "care_reports_careSessionId_key" ON "care_reports"("careSessionId");
CREATE INDEX IF NOT EXISTS "care_reports_riskLevel_createdAt_idx" ON "care_reports"("riskLevel", "createdAt");
CREATE INDEX IF NOT EXISTS "care_checkins_careUserId_createdAt_idx" ON "care_checkins"("careUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "care_instrument_responses_careUserId_instrumentKey_createdAt_idx" ON "care_instrument_responses"("careUserId", "instrumentKey", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "care_sessions" ADD CONSTRAINT "care_sessions_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "care_reports" ADD CONSTRAINT "care_reports_careSessionId_fkey"
    FOREIGN KEY ("careSessionId") REFERENCES "care_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "care_checkins" ADD CONSTRAINT "care_checkins_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "care_instrument_responses" ADD CONSTRAINT "care_instrument_responses_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
