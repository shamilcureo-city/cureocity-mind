-- Sprint 20 — Client-facing Progress Report (measurement-based care).
--
-- Adds the PROGRESS_REPORT artefact type so therapists can share a
-- plain-language pre→post outcome view with the client via the
-- existing PatientShare flow. Content is built deterministically from
-- the reliable-change engine (Phase 1) + the active treatment plan;
-- no LLM call.
--
-- Two new AuditAction values cover the lifecycle: GENERATED fires
-- whenever the snapshot is built (regardless of whether a send
-- succeeds), SHARED fires per-channel inside the existing share route.

ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'PROGRESS_REPORT';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_PROGRESS_REPORT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_PROGRESS_REPORT_SHARED';
