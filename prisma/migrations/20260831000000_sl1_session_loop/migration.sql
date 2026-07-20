-- SL1 — The Session Loop: living formulation, session agreements, alliance
-- feedback. Idempotent (guarded) per the migration convention: safe for the
-- P3009 self-heal to replay.

-- New enums (guarded creates).
DO $$ BEGIN CREATE TYPE "AllianceRating" AS ENUM ('ROUGH', 'FLAT', 'GOOD', 'STRONG');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AgreementSpeaker" AS ENUM ('CLIENT', 'THERAPIST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "AgreementFollowUp" AS ENUM ('DONE', 'PARTLY', 'NOT_YET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- One-tap alliance read at session close.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "allianceRating" "AllianceRating";

-- The living formulation — versioned per client, like treatment_plans.
CREATE TABLE IF NOT EXISTS "case_formulations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_formulations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_formulations_clientId_version_key" ON "case_formulations"("clientId", "version");
CREATE INDEX IF NOT EXISTS "case_formulations_clientId_supersededAt_idx" ON "case_formulations"("clientId", "supersededAt");

DO $$ BEGIN
  ALTER TABLE "case_formulations" ADD CONSTRAINT "case_formulations_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "case_formulations" ADD CONSTRAINT "case_formulations_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Session agreements — "what we agreed", in the client's words.
CREATE TABLE IF NOT EXISTS "session_agreements" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "speaker" "AgreementSpeaker" NOT NULL,
    "text" TEXT NOT NULL,
    "followUp" "AgreementFollowUp",
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_agreements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "session_agreements_sessionId_idx" ON "session_agreements"("sessionId");
CREATE INDEX IF NOT EXISTS "session_agreements_clientId_createdAt_idx" ON "session_agreements"("clientId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "session_agreements" ADD CONSTRAINT "session_agreements_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "session_agreements" ADD CONSTRAINT "session_agreements_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "session_agreements" ADD CONSTRAINT "session_agreements_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Audit actions (literal writers per the chaos-test rule).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FORMULATION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AGREEMENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_FEEDBACK_RECORDED';
