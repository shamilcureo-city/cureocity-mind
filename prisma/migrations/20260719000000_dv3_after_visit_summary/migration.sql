-- Sprint DV3 — doctor after-visit summary patient-share artefact type.
-- Append-only enum value (idempotent), per the per-sprint convention.
-- See docs/DOCTOR_VERTICAL.md §6.
ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'AFTER_VISIT_SUMMARY';
