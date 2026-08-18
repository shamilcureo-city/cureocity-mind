-- Immutable, queryable snapshots of superseded clinical-note signatures.
CREATE TABLE IF NOT EXISTS "note_signature_versions" (
  "id" TEXT NOT NULL,
  "therapyNoteId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "contentHashHex" TEXT NOT NULL,
  "rxPad" JSONB,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "signedBy" TEXT NOT NULL,
  "signCredentialId" TEXT,
  "signClientDataJsonB64u" TEXT,
  "signAuthenticatorDataB64u" TEXT,
  "signSignatureB64u" TEXT,
  "signChallengeHashHex" TEXT,
  "signPayload" TEXT,
  "medicalSigningCredentialId" TEXT,
  "medicalSigningCredentialSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_signature_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "therapy_notes" ADD COLUMN IF NOT EXISTS "signPayload" TEXT;
ALTER TABLE "note_signature_versions" ADD COLUMN IF NOT EXISTS "signPayload" TEXT;

CREATE INDEX IF NOT EXISTS "note_signature_versions_therapyNoteId_createdAt_idx"
  ON "note_signature_versions"("therapyNoteId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'note_signature_versions_therapyNoteId_fkey'
      AND conrelid = 'note_signature_versions'::regclass
  ) THEN
    ALTER TABLE "note_signature_versions"
      ADD CONSTRAINT "note_signature_versions_therapyNoteId_fkey"
      FOREIGN KEY ("therapyNoteId") REFERENCES "therapy_notes"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION reject_note_signature_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'note_signature_versions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS "note_signature_versions_append_only" ON "note_signature_versions";
CREATE TRIGGER "note_signature_versions_append_only"
BEFORE UPDATE OR DELETE ON "note_signature_versions"
FOR EACH ROW EXECUTE FUNCTION reject_note_signature_version_mutation();

DROP TRIGGER IF EXISTS "note_signature_versions_no_truncate" ON "note_signature_versions";
CREATE TRIGGER "note_signature_versions_no_truncate"
BEFORE TRUNCATE ON "note_signature_versions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_note_signature_version_mutation();
