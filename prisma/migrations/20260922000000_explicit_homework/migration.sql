ALTER TYPE "ExerciseAssignmentSource" ADD VALUE IF NOT EXISTS 'CUSTOM';
ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'HOMEWORK';
ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'SESSION_TAKEAWAY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_SHARE_REFRESH_REQUESTED';

ALTER TABLE "exercise_assignments"
  ADD COLUMN IF NOT EXISTS "frequency" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryChannel" "PatientShareChannel";

ALTER TABLE "exercise_assignments"
  ADD COLUMN IF NOT EXISTS "respondedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "responseShareId" TEXT,
  ADD COLUMN IF NOT EXISTS "responseShareBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "exercise_assignments_responseShareId_idx"
  ON "exercise_assignments"("responseShareId");

CREATE INDEX IF NOT EXISTS "exercise_assignments_sourceSessionId_idx"
  ON "exercise_assignments"("sourceSessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_assignments_idempotencyKey_key"
  ON "exercise_assignments"("idempotencyKey");

-- Preserve legacy assignment rows while removing dangling or cross-tenant
-- provenance before the new nullable foreign keys are installed.
UPDATE "exercise_assignments" AS assignment
SET "sourceSessionId" = NULL
WHERE assignment."sourceSessionId" IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM "sessions" AS s
      WHERE s."id" = assignment."sourceSessionId"
    )
    OR EXISTS (
      SELECT 1 FROM "sessions" AS s
      WHERE s."id" = assignment."sourceSessionId"
        AND (
          s."clientId" <> assignment."clientId"
          OR s."psychologistId" <> assignment."psychologistId"
        )
    )
  );

UPDATE "exercise_assignments" AS assignment
SET "responseShareId" = NULL
WHERE assignment."responseShareId" IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM "patient_shares" AS share
      WHERE share."id" = assignment."responseShareId"
    )
    OR EXISTS (
      SELECT 1 FROM "patient_shares" AS share
      WHERE share."id" = assignment."responseShareId"
        AND (
          share."clientId" <> assignment."clientId"
          OR share."psychologistId" <> assignment."psychologistId"
        )
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS catalog_constraint
    JOIN pg_class AS relation ON relation.oid = catalog_constraint.conrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_constraint.conname = 'exercise_assignments_sourceSessionId_fkey'
      AND catalog_constraint.conrelid = 'exercise_assignments'::regclass
      AND schema.nspname = current_schema()
  ) THEN
    ALTER TABLE "exercise_assignments"
      ADD CONSTRAINT "exercise_assignments_sourceSessionId_fkey"
      FOREIGN KEY ("sourceSessionId") REFERENCES "sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS catalog_constraint
    JOIN pg_class AS relation ON relation.oid = catalog_constraint.conrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_constraint.conname = 'exercise_assignments_responseShareId_fkey'
      AND catalog_constraint.conrelid = 'exercise_assignments'::regclass
      AND schema.nspname = current_schema()
  ) THEN
    ALTER TABLE "exercise_assignments"
      ADD CONSTRAINT "exercise_assignments_responseShareId_fkey"
      FOREIGN KEY ("responseShareId") REFERENCES "patient_shares"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "patient_shares"
  ADD COLUMN IF NOT EXISTS "refreshRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refreshRequestCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shareBatchId" TEXT,
  ADD COLUMN IF NOT EXISTS "resendOfId" TEXT;

ALTER TABLE "patient_shares"
  ADD COLUMN IF NOT EXISTS "requestIdempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "requestPayloadHash" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispatchLeaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "patient_shares_psychologistId_requestIdempotencyKey_channel_key"
  ON "patient_shares"("psychologistId", "requestIdempotencyKey", "channel");

CREATE UNIQUE INDEX IF NOT EXISTS "patient_shares_resendOfId_key"
  ON "patient_shares"("resendOfId");

CREATE INDEX IF NOT EXISTS "patient_shares_shareBatchId_idx"
  ON "patient_shares"("shareBatchId");

-- Historical adapters stored raw provider exception text here. Retain only
-- the bounded errorCode diagnostic; raw recipient/provider details are erased.
UPDATE "patient_shares" SET "errorDetail" = NULL
WHERE "errorDetail" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "share_rate_reservations" (
  "id" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "shareBatchId" TEXT NOT NULL,
  "fanout" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_rate_reservations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "share_rate_reservations_shareBatchId_key"
  ON "share_rate_reservations"("shareBatchId");
CREATE INDEX IF NOT EXISTS "share_rate_reservations_psychologistId_createdAt_idx"
  ON "share_rate_reservations"("psychologistId", "createdAt");

ALTER TABLE "mind_session_closeout_states"
  ADD COLUMN IF NOT EXISTS "patientTakeaway" TEXT;

ALTER TABLE "client_claim_tokens"
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

-- Repeated issuance supersedes older active claims. Clean historical
-- duplicates without falsifying redemption before enforcing one active token.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "clientId" ORDER BY "issuedAt" DESC, "id" DESC
  ) AS rn
  FROM "client_claim_tokens"
  WHERE "redeemedAt" IS NULL AND "supersededAt" IS NULL
)
UPDATE "client_claim_tokens" AS token
SET "supersededAt" = NOW()
FROM ranked
WHERE token."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "client_claim_tokens_one_unredeemed_per_client"
  ON "client_claim_tokens"("clientId")
  WHERE "redeemedAt" IS NULL AND "supersededAt" IS NULL;

CREATE INDEX IF NOT EXISTS "client_claim_tokens_clientId_redeemedAt_supersededAt_idx"
  ON "client_claim_tokens"("clientId", "redeemedAt", "supersededAt");
