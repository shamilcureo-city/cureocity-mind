-- Sprint DV3 — doctor medical-encounter note audit lifecycle.
-- Append-only enum values (idempotent), per the per-sprint migration
-- convention. See docs/DOCTOR_VERTICAL.md.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCOUNTER_NOTE_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCOUNTER_NOTE_SIGNED';
