-- Sprint TSC — copilot decision board.
-- 1. Client.carriedQuestions: questions the therapist ticked to carry into
--    the next session (JSON array; replaced wholesale on each save).
-- 2. CARRIED_QUESTIONS_UPDATED audit action for that save.
-- Idempotent (safe to replay) per the migration convention.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "carriedQuestions" JSONB;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARRIED_QUESTIONS_UPDATED';
