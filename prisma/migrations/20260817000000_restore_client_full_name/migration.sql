-- Reconcile databases where the transitional plaintext patient-name column was
-- removed before the application completed its encrypted-name read cutover.
--
-- Client.fullName is still required by the current Prisma schema. Using
-- IF NOT EXISTS keeps this migration safe for databases created entirely from
-- the checked-in migration history, where the column is already present.
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "fullName" TEXT;

-- A removed plaintext value cannot be reconstructed from its ciphertext in
-- SQL. Give pre-existing rows a non-identifying placeholder so the required
-- application invariant can be restored; normal application writes continue
-- to populate both the plaintext and encrypted transition columns.
UPDATE "clients"
SET "fullName" = 'Patient'
WHERE "fullName" IS NULL;

ALTER TABLE "clients"
  ALTER COLUMN "fullName" SET NOT NULL;
