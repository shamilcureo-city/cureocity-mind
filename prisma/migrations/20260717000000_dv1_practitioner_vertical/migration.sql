-- Sprint DV1 — doctor vertical foundation.
-- Adds the product-vertical discriminator + doctor credential fields to
-- Psychologist. Idempotent (guards) so re-runs are safe, per the
-- per-sprint migration convention. See docs/DOCTOR_VERTICAL.md.

-- CreateEnum (idempotent — CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE "PractitionerVertical" AS ENUM ('THERAPIST', 'DOCTOR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "psychologists"
  ADD COLUMN IF NOT EXISTS "vertical" "PractitionerVertical" NOT NULL DEFAULT 'THERAPIST',
  ADD COLUMN IF NOT EXISTS "medicalRegNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "specialty" TEXT;

-- CreateIndex (nullable unique — multiple NULLs allowed in Postgres, so
-- every therapist row coexists; only real doctor reg numbers are unique)
CREATE UNIQUE INDEX IF NOT EXISTS "psychologists_medicalRegNumber_key"
  ON "psychologists" ("medicalRegNumber");
