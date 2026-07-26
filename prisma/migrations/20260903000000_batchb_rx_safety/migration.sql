-- Batch B — prescription safety.
--
-- RX_SAFETY_OVERRIDE records a prescriber signing PAST a hard drug-allergy
-- contraindication with a stated reason. Idempotent per the repo convention
-- (CLAUDE.md §4) — this migration is safe to replay after a P3009 self-heal.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RX_SAFETY_OVERRIDE';

-- The patient's recorded drug allergies. The Rx pad has always printed an
-- allergy list and the safety rail has always had a slot for it, but there
-- was no field to record one in — so it was structurally always empty.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "allergies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
