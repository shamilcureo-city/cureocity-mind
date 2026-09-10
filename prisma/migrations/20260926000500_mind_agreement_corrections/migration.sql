-- Additive only. No signed-note content is changed or backfilled.
ALTER TABLE "session_agreements"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "revisions" JSONB,
  ADD COLUMN IF NOT EXISTS "creationOperationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "session_agreements_sessionId_creationOperationId_key"
  ON "session_agreements"("sessionId", "creationOperationId");
