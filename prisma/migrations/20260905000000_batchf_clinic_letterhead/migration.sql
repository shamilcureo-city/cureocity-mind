-- Batch F — the prescription letterhead.
--
-- The Rx PDF has always rendered a clinic line and always passed
-- `clinicName: null`, so every prescription went out with a blank letterhead.
-- Idempotent per the repo convention (CLAUDE.md §4).
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "clinicName" TEXT;
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "clinicAddress" TEXT;
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "clinicPhone" TEXT;
