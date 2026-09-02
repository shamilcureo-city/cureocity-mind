ALTER TABLE "patient_shares"
  ADD COLUMN IF NOT EXISTS "recipientEnvelope" JSONB,
  ADD COLUMN IF NOT EXISTS "recipientEnvelopeEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "therapistMessageEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchLeaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchLeaseVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "verifiedNonDeliveryAt" TIMESTAMP(3);

-- Historical plaintext cannot be transformed into a tenant KMS envelope in
-- SQL. Erase it at cutover (including the abandoned plaintext JSON envelope).
-- The predicates make this safe and replayable; legacy rows require recipient
-- reconfirmation before any resend rather than retaining contact PHI.
UPDATE "patient_shares"
SET "toContact" = NULL,
    "recipientEnvelope" = NULL
WHERE "toContact" IS NOT NULL OR "recipientEnvelope" IS NOT NULL;

ALTER TABLE "share_rate_reservations"
  ADD COLUMN IF NOT EXISTS "ownerToken" TEXT,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

UPDATE "share_rate_reservations"
SET "ownerToken" = COALESCE("ownerToken", "id"),
    "expiresAt" = COALESCE("expiresAt", "createdAt" + INTERVAL '5 minutes');

ALTER TABLE "share_rate_reservations"
  ALTER COLUMN "ownerToken" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "share_rate_reservations_ownerToken_key"
  ON "share_rate_reservations"("ownerToken");

DO $$ BEGIN
  CREATE TYPE "CrisisAlertAttemptStatus" AS ENUM
    ('PENDING', 'SUBMISSION_STARTED', 'SENT', 'FAILED', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crisis_alert_attempts" (
  "id" TEXT NOT NULL,
  "instrumentResponseId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" "CrisisAlertAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "submissionStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crisis_alert_attempts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "crisis_alert_attempts"
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "crisis_alert_attempts_instrumentResponseId_key"
  ON "crisis_alert_attempts"("instrumentResponseId");
CREATE INDEX IF NOT EXISTS "crisis_alert_attempts_status_createdAt_idx"
  ON "crisis_alert_attempts"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "crisis_alert_attempts_psychologistId_createdAt_idx"
  ON "crisis_alert_attempts"("psychologistId", "createdAt");

ALTER TABLE "instrument_responses"
  ADD COLUMN IF NOT EXISTS "sourcePatientShareId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceShareBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "instrument_responses_sourcePatientShareId_idx"
  ON "instrument_responses"("sourcePatientShareId");
CREATE INDEX IF NOT EXISTS "instrument_responses_sourceShareBatchId_idx"
  ON "instrument_responses"("sourceShareBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instrument_responses_sourcePatientShareId_fkey'
  ) THEN
    ALTER TABLE "instrument_responses"
      ADD CONSTRAINT "instrument_responses_sourcePatientShareId_fkey"
      FOREIGN KEY ("sourcePatientShareId") REFERENCES "patient_shares"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
