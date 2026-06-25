-- Sprint 65b — discharge / treatment summary PDF export.
-- New audit action for the clinician-facing end-of-episode summary.
-- Append-only + idempotent so re-runs are safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DISCHARGE_SUMMARY_EXPORTED';
