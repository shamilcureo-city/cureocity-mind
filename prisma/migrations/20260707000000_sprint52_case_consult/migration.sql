-- Sprint 52 — Case Consult (Pass 8).
--
-- A structured second opinion the therapist generates when they are
-- stuck on a case. Reuses the case-briefing context assembler so the
-- only new infrastructure is the artefact itself: a new pass enum
-- value, a new audit action, and a cached row keyed by (clientId,
-- lastSessionId) — same shape as PreSessionBrief.
--
-- 1. CaseConsultStatus enum (PENDING / COMPLETED / FAILED), mirrors
--    PreSessionBriefStatus. Defined fresh + used in the same
--    migration so the enum-creation-then-use restriction doesn't apply.
-- 2. GeminiPass += PASS_8_CASE_CONSULT.
-- 3. AuditAction += CASE_CONSULT_GENERATED.
-- 4. case_consults table mirroring pre_session_briefs:
--    cached per (clientId, lastSessionId), body Json, totalCostInr.

DO $$ BEGIN
  CREATE TYPE "CaseConsultStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_8_CASE_CONSULT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CASE_CONSULT_GENERATED';

CREATE TABLE IF NOT EXISTS "case_consults" (
  "id"             TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "lastSessionId"  TEXT,
  "status"         "CaseConsultStatus" NOT NULL DEFAULT 'PENDING',
  "body"           JSONB,
  "totalCostInr"   DECIMAL(10,4) NOT NULL DEFAULT 0,
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_consults_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_consults_clientId_fkey" FOREIGN KEY ("clientId")
    REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "case_consults_clientId_createdAt_idx"
  ON "case_consults" ("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "case_consults_psychologistId_createdAt_idx"
  ON "case_consults" ("psychologistId", "createdAt");
