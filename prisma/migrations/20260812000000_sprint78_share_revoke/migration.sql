-- SHARE-1 — a therapist can revoke a shared patient link (wrong recipient /
-- wrong artefact). REVOKED is a terminal PatientShareStatus: the portal stops
-- rendering the artefact and no longer audits opens. `revokedAt` timestamps it;
-- PATIENT_SHARE_REVOKED is the audit trail.
--
-- Idempotent (safe to replay after a P3009 self-heal): guarded ADD VALUE /
-- ADD COLUMN throughout.
ALTER TYPE "PatientShareStatus" ADD VALUE IF NOT EXISTS 'REVOKED';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_SHARE_REVOKED';

ALTER TABLE "patient_shares" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
