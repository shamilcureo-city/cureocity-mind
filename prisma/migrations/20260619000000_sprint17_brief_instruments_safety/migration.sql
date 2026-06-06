-- Sprint 17 — Pre-session brief + scored instruments + safety plan.
--
-- Adds three tables that fill in the missing connective tissue
-- between sessions:
--   * pre_session_briefs — Pass 5 cached per (client, lastSession, language)
--   * instrument_responses — PHQ-9 / GAD-7 administrations with score + severity
--   * safety_plans — Stanley & Brown 5-step crisis plans, supersedable
--
-- Also extends the enum surface for the new pass + audit actions.

-- ---------------------------------------------------------------------------
-- GeminiPass + AuditAction additions
-- ---------------------------------------------------------------------------

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_5_PRE_SESSION_BRIEF';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRE_SESSION_BRIEF_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRE_SESSION_BRIEF_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INSTRUMENT_ADMINISTERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INSTRUMENT_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAFETY_PLAN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAFETY_PLAN_UPDATED';

-- ---------------------------------------------------------------------------
-- PreSessionBriefStatus enum + pre_session_briefs table
-- ---------------------------------------------------------------------------

CREATE TYPE "PreSessionBriefStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "pre_session_briefs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "lastSessionId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "PreSessionBriefStatus" NOT NULL DEFAULT 'PENDING',
    "body" JSONB,
    "totalCostInr" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_session_briefs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pre_session_briefs_clientId_createdAt_idx"
    ON "pre_session_briefs"("clientId", "createdAt");
CREATE INDEX "pre_session_briefs_psychologistId_createdAt_idx"
    ON "pre_session_briefs"("psychologistId", "createdAt");

ALTER TABLE "pre_session_briefs"
    ADD CONSTRAINT "pre_session_briefs_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pre_session_briefs"
    ADD CONSTRAINT "pre_session_briefs_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- instrument_responses
-- ---------------------------------------------------------------------------

CREATE TABLE "instrument_responses" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sessionId" TEXT,
    "instrumentKey" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "responses" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "administeredAt" TIMESTAMP(3) NOT NULL,
    "administeredByPsychologistId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instrument_responses_clientId_instrumentKey_administeredAt_idx"
    ON "instrument_responses"("clientId", "instrumentKey", "administeredAt");
CREATE INDEX "instrument_responses_psychologistId_createdAt_idx"
    ON "instrument_responses"("psychologistId", "createdAt");

ALTER TABLE "instrument_responses"
    ADD CONSTRAINT "instrument_responses_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instrument_responses"
    ADD CONSTRAINT "instrument_responses_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "instrument_responses"
    ADD CONSTRAINT "instrument_responses_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- safety_plans
-- ---------------------------------------------------------------------------

CREATE TABLE "safety_plans" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedByPsychologistId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "safety_plans_clientId_supersededAt_idx"
    ON "safety_plans"("clientId", "supersededAt");
CREATE INDEX "safety_plans_psychologistId_createdAt_idx"
    ON "safety_plans"("psychologistId", "createdAt");

ALTER TABLE "safety_plans"
    ADD CONSTRAINT "safety_plans_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "safety_plans"
    ADD CONSTRAINT "safety_plans_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "safety_plans"
    ADD CONSTRAINT "safety_plans_sourceSessionId_fkey"
    FOREIGN KEY ("sourceSessionId") REFERENCES "sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
