-- Sprint 71 — signed notes can be unlocked for editing and re-signed.
-- Idempotent (CLAUDE.md §4): safe to replay under the P3009 self-heal.

ALTER TABLE "therapy_notes" ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT true;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTE_UNLOCKED';
