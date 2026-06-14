-- Sprint 49 — intake note lifecycle parity (sign + share + PDF).
--
-- Today the spine assumes every signed note is a TherapyNoteV1 (SOAP):
--   * NoteEditField only has the four SOAP fields.
--   * SignNoteInput.note is TherapyNoteV1Schema, so intake notes can't
--     be submitted to the sign route at all.
--   * PatientShareArtefactType.SIGNED_NOTE renders a SOAP-shaped
--     snapshot — intake notes have nothing to render.
--
-- A trial user's first session is almost always an intake; today that
-- session dead-ends unsigned and unshareable. This migration adds the
-- two enum surfaces needed to make intake notes signable, editable,
-- and shareable at parity with TREATMENT notes.
--
-- 1. NoteEditField += 8 intake fields. SignNoteInput's `edits` now
--    accepts edits to any of the intake sections; the sign route picks
--    the kind-keyed field-set before validating.
-- 2. PatientShareArtefactType.SIGNED_INTAKE_NOTE — new artefact value.
--    Distinct snapshot shape (intake sections, not SOAP) so pre-S49
--    SIGNED_NOTE shares keep parsing in the portal.

ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'presentingConcerns';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'historyOfPresentingIllness';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'pastPsychiatricHistory';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'familyHistory';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'socialHistory';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'mentalStatusExam';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'workingHypothesis';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'immediatePlan';

ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'SIGNED_INTAKE_NOTE';
