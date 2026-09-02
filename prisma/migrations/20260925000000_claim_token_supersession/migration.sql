-- R2-09 — represent claim-token supersession without falsifying redemption.
-- This fix-forward is safe whether 20260922000000 ran in its old form, its
-- corrected form, or has not run yet; every DDL statement is replay-safe.

ALTER TABLE "client_claim_tokens"
  ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

-- The earlier cleanup marked superseded duplicate tokens as redeemed while
-- leaving the redeemer UID null. Preserve the terminal timestamp but classify
-- those rows honestly. True redemptions always have a UID and remain untouched.
UPDATE "client_claim_tokens"
SET "supersededAt" = "redeemedAt",
    "redeemedAt" = NULL
WHERE "redeemedAt" IS NOT NULL
  AND "redeemedByFirebaseUid" IS NULL;

-- Also cover a database where the earlier migration has not run: retain the
-- newest active token and supersede older active duplicates before uniqueness.
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

-- The previous index name may exist with the old redeemedAt-only predicate;
-- replace it so both terminal states are excluded from active uniqueness.
DROP INDEX IF EXISTS "client_claim_tokens_one_unredeemed_per_client";
CREATE UNIQUE INDEX IF NOT EXISTS "client_claim_tokens_one_unredeemed_per_client"
  ON "client_claim_tokens"("clientId")
  WHERE "redeemedAt" IS NULL AND "supersededAt" IS NULL;

CREATE INDEX IF NOT EXISTS "client_claim_tokens_clientId_redeemedAt_supersededAt_idx"
  ON "client_claim_tokens"("clientId", "redeemedAt", "supersededAt");

-- New writes must have exactly one honest terminal state: redemption has both
-- timestamp and UID, while supersession has neither redemption field.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS catalog_constraint
    JOIN pg_class AS relation ON relation.oid = catalog_constraint.conrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_constraint.conname = 'client_claim_tokens_terminal_state_check'
      AND catalog_constraint.conrelid = 'client_claim_tokens'::regclass
      AND schema.nspname = current_schema()
  ) THEN
    ALTER TABLE "client_claim_tokens"
      ADD CONSTRAINT "client_claim_tokens_terminal_state_check"
      CHECK (
        ("redeemedAt" IS NULL) = ("redeemedByFirebaseUid" IS NULL)
        AND NOT ("redeemedAt" IS NOT NULL AND "supersededAt" IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE "client_claim_tokens"
  VALIDATE CONSTRAINT "client_claim_tokens_terminal_state_check";
