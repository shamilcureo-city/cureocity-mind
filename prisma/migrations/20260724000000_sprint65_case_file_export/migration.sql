-- Sprint 65 — case-file PDF export.
-- New audit action for "therapist downloaded the whole client chart as a PDF".
-- Append-only + idempotent so re-runs are safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CASE_FILE_EXPORTED';
