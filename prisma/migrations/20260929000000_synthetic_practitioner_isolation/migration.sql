BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "psychologists"
  ADD COLUMN IF NOT EXISTS "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

-- The deterministic analytics/demo cohort has always used this reserved UID
-- prefix. Backfill it now so the deployment that adds the boundary stops
-- counting already-seeded rows immediately, before any seed is rerun.
UPDATE "psychologists"
SET "isSynthetic" = true
WHERE "firebaseUid" LIKE 'seed-%';

CREATE INDEX IF NOT EXISTS "psychologists_isSynthetic_idx"
  ON "psychologists"("isSynthetic");

COMMIT;
