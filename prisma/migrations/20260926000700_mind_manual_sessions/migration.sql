-- Additive and replay-safe. Existing sessions retain their existing capture behavior.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_PURPOSE_SELECTED';
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mindPurpose" TEXT;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "mindDocumentationMode" TEXT;
CREATE TABLE IF NOT EXISTS "mind_manual_note_drafts" (
  "sessionId" TEXT PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
  "encryptedFields" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "lastMutationId" UUID,
  "lastMutationHashEncrypted" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
