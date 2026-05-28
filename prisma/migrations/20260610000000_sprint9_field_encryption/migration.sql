-- Sprint 9 PR 3 — field-level encryption (gap G10).
-- Adds nullable encrypted companions to the four PII columns plus the
-- PsychologistTenantKey table. Sprint 10 hardening backfills, then drops
-- the plaintext columns in a separate migration.

-- CreateTable: psychologist_tenant_keys
CREATE TABLE "psychologist_tenant_keys" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "psychologist_tenant_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "psychologist_tenant_keys_psychologistId_retiredAt_idx" ON "psychologist_tenant_keys"("psychologistId", "retiredAt");

ALTER TABLE "psychologist_tenant_keys" ADD CONSTRAINT "psychologist_tenant_keys_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: clients — encrypted companions for contactPhone + contactEmail
ALTER TABLE "clients"
  ADD COLUMN "contactPhoneEncrypted" TEXT,
  ADD COLUMN "contactEmailEncrypted" TEXT;

-- AlterTable: journal_entries — encrypted companion for content
ALTER TABLE "journal_entries"
  ADD COLUMN "contentEncrypted" TEXT;

-- AlterTable: note_drafts — encrypted companion for transcript
ALTER TABLE "note_drafts"
  ADD COLUMN "transcriptEncrypted" TEXT;
