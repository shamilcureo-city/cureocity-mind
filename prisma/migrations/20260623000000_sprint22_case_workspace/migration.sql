-- Sprint 22 — Case Workspace: running differential + case briefing.
--
-- AssessmentItem turns Pass 3's per-session assessmentGaps + candidate
-- gapsToFill into PERSISTENT, trackable diagnostic questions (the
-- "running differential") that carry forward and close over sessions.
-- Pass 6 (case briefing) is a new GeminiPass value. Audit actions track
-- item lifecycle + briefing generation.

-- ---------------------------------------------------------------------------
-- AssessmentItem enums + table.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE "AssessmentItemStatus" AS ENUM ('OPEN', 'ADDRESSED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "AssessmentItemKind" AS ENUM ('DIAGNOSTIC_CRITERION', 'ASSESSMENT_GAP', 'INSTRUMENT', 'SAFETY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "assessment_items" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "episodeId" TEXT,
    "kind" "AssessmentItemKind" NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "icd11Code" TEXT,
    "status" "AssessmentItemStatus" NOT NULL DEFAULT 'OPEN',
    "sourceSessionId" TEXT,
    "addressedSessionId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "assessment_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assessment_items_clientId_status_idx"
    ON "assessment_items" ("clientId", "status");

DO $$ BEGIN
    ALTER TABLE "assessment_items"
        ADD CONSTRAINT "assessment_items_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "clients" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- Pass 6 GeminiPass value + audit actions.
-- ---------------------------------------------------------------------------

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_6_CASE_BRIEFING';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ASSESSMENT_ITEM_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ASSESSMENT_ITEM_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CASE_BRIEFING_GENERATED';
