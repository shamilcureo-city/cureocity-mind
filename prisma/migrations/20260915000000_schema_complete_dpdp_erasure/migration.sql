-- Schema-complete DPDP erasure proof + external-object deletion outbox.
-- Append-ordered after 20260914000000_dpdp_signed_note_erasure.

DO $$ BEGIN
  CREATE TYPE "ErasureObjectDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "ErasureObjectDeletionStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "client_erasure_requests"
  ADD COLUMN IF NOT EXISTS "reasonHashHex" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionNotesHashHex" TEXT;

CREATE TABLE IF NOT EXISTS "erasure_object_deletion_tasks" (
  "id" TEXT NOT NULL,
  "erasureRequestId" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "objectKey" TEXT,
  "objectKeyHashHex" TEXT NOT NULL,
  "status" "ErasureObjectDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "erasure_object_deletion_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "erasure_object_deletion_tasks_erasureRequestId_storageProv_key"
  ON "erasure_object_deletion_tasks"("erasureRequestId", "storageProvider", "objectKeyHashHex");
CREATE INDEX IF NOT EXISTS "erasure_object_deletion_tasks_status_nextAttemptAt_leaseExpiresAt_idx"
  ON "erasure_object_deletion_tasks"("status", "nextAttemptAt", "leaseExpiresAt");

DO $$ BEGIN
  ALTER TABLE "erasure_object_deletion_tasks"
    ADD CONSTRAINT "erasure_object_deletion_tasks_erasureRequestId_fkey"
    FOREIGN KEY ("erasureRequestId") REFERENCES "client_erasure_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Fix forward: supersede the 20260914 function without changing its applied
-- checksum. Retain only attestation hashes ("contentHashHex" and
-- "signChallengeHashHex"), timestamps, actor identifiers and bounded
-- note-version metadata; erase clinical content and raw credential/assertion
-- material from both the current note and signature history.
CREATE OR REPLACE FUNCTION redact_client_signed_note_phi(
  erasure_request_id TEXT,
  resolving_psychologist_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_client_id TEXT;
  redacted_count INTEGER;
BEGIN
  SELECT r."clientId" INTO target_client_id
  FROM "client_erasure_requests" r
  JOIN "clients" c ON c."id" = r."clientId"
  WHERE r."id" = erasure_request_id
    AND c."psychologistId" = resolving_psychologist_id
    AND r."status" IN ('PENDING', 'APPROVED')
  FOR UPDATE OF r, c;
  IF target_client_id IS NULL THEN
    RAISE EXCEPTION 'erasure request is missing, unauthorized, or no longer actionable';
  END IF;

  PERFORM set_config('app.note_signature_erasure_context', 'lawful_erasure', true);
  PERFORM set_config('app.therapy_note_write_context', 'erasure', true);

  UPDATE "note_signature_versions" v
  SET "content" = '{}'::jsonb,
      "rxPad" = NULL,
      "signCredentialId" = NULL,
      "signClientDataJsonB64u" = NULL,
      "signAuthenticatorDataB64u" = NULL,
      "signSignatureB64u" = NULL,
      "signPayload" = NULL,
      "medicalSigningCredentialId" = NULL,
      "medicalSigningCredentialSnapshot" = NULL
  FROM "therapy_notes" n, "sessions" s
  WHERE v."therapyNoteId" = n."id"
    AND n."sessionId" = s."id"
    AND s."clientId" = target_client_id;

  UPDATE "therapy_notes" n
  SET "content" = '{}'::jsonb,
      "rxPad" = NULL,
      "signCredentialId" = NULL,
      "signClientDataJsonB64u" = NULL,
      "signAuthenticatorDataB64u" = NULL,
      "signSignatureB64u" = NULL,
      "signPayload" = NULL,
      "medicalSigningCredentialId" = NULL,
      "medicalSigningCredentialSnapshot" = NULL
  FROM "sessions" s
  WHERE n."sessionId" = s."id" AND s."clientId" = target_client_id;
  GET DIAGNOSTICS redacted_count = ROW_COUNT;
  RETURN redacted_count;
END;
$$;

-- CREATE OR REPLACE preserves the owner and existing ACL. Revoke the default
-- function EXECUTE grant again so only the privileged migration owner can call
-- this SECURITY DEFINER path; the runtime role receives no function grant.
REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT) FROM PUBLIC;
