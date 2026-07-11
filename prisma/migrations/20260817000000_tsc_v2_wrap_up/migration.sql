-- Sprint TSC-V2 — copilot decision board wrap-up.
-- 1. ClinicalReport.reviewedAt: set when the therapist taps "Finish review"
--    on the board's wrap-up step (a checkpoint, not a lock — decisions stay
--    revisable after).
-- 2. COPILOT_REVIEW_FINISHED audit action for that event.
-- Idempotent (safe to replay) per the migration convention.

ALTER TABLE "clinical_reports" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COPILOT_REVIEW_FINISHED';
