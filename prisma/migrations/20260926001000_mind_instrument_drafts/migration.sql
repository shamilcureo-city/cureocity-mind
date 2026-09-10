ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MIND_INSTRUMENT_DRAFT_SAVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MIND_INSTRUMENT_DRAFT_DISCARDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MIND_INSTRUMENT_DRAFT_VIEWED';

CREATE TABLE IF NOT EXISTS "mind_instrument_drafts" (
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "psychologistId" TEXT NOT NULL,
  "instrumentKey" TEXT NOT NULL CHECK ("instrumentKey" IN ('PHQ9', 'GAD7')),
  "answersEncrypted" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'SUBMITTED', 'DISCARDED')),
  "lastMutationId" TEXT,
  "lastMutationHash" TEXT,
  "submittedResponseId" TEXT,
  "riskFlagged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("clientId", "instrumentKey"),
  CHECK ("status" = 'ACTIVE' OR "answersEncrypted" IS NULL)
);
CREATE INDEX IF NOT EXISTS "mind_instrument_draft_owner_idx"
  ON "mind_instrument_drafts" ("psychologistId", "updatedAt");
