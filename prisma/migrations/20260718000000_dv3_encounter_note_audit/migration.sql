-- Sprint DV3 — doctor medical-encounter note audit lifecycle.
-- Append-only enum values (idempotent), per the per-sprint migration
-- convention. See docs/DOCTOR_VERTICAL.md.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCOUNTER_NOTE_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCOUNTER_NOTE_SIGNED';

-- Sprint DV3 — medical encounter note signable string fields, so the
-- NoteEdit.field column accepts them (the sign route reuses the
-- therapy NoteEdit machinery for the doctor encounter note).
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'chiefComplaint';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'hpi';
