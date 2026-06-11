-- Sprint 47 — client self-serve check-ins.
--
-- The therapist sends a PHQ-9 / GAD-7 the client completes themselves
-- from the portal between sessions. The submission scores into the
-- same instrument_responses trend the in-session runner feeds, tagged
-- with how it was administered.
--
-- 1. INSTRUMENT_CHECKIN — new patient-share artefact type (interactive).
-- 2. PATIENT_CHECKIN_SUBMITTED — audit action the public submit route
--    writes (CRISIS_FLAG_RAISED is reused on a flagged item-9 endorsement).
-- 3. InstrumentAdministrationMode — CLINICIAN (default, back-compatible
--    with every existing row) vs SELF (remote portal check-in).
--
-- A freshly CREATEd enum can be used as a column type + default in the
-- same migration; only ALTER TYPE ... ADD VALUE on a pre-existing enum
-- carries the same-transaction-use restriction, and neither new value
-- here is consumed within this migration.

ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'INSTRUMENT_CHECKIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_CHECKIN_SUBMITTED';

DO $$ BEGIN
  CREATE TYPE "InstrumentAdministrationMode" AS ENUM ('CLINICIAN', 'SELF');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "instrument_responses"
  ADD COLUMN IF NOT EXISTS "administrationMode" "InstrumentAdministrationMode" NOT NULL DEFAULT 'CLINICIAN';
