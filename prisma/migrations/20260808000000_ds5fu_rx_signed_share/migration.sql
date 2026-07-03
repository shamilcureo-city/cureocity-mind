-- Sprint DS5-fu — signed prescription pad + patient-share artefact.
--
-- (1) TherapyNote.rxPad: the SIGNED Rx pad (RxPadV1, confirmed meds only),
--     derived from NoteDraft.rxPad at sign time so the signature attests it.
-- (2) RX_PAD patient-share artefact type + its distinct share-audit action.
--
-- Idempotent per CLAUDE.md §4 (guarded DDL — safe to replay under the P3009
-- self-heal). Enum ADD VALUEs are append-only; this migration only ADDs the
-- values (never references them in data in the same tx), so it is safe.

ALTER TABLE "therapy_notes" ADD COLUMN IF NOT EXISTS "rxPad" JSONB;

ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'RX_PAD';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_RX_PAD_SHARED';
