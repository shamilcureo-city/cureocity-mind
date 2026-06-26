-- Sprint 70 — audit action for applying a note template to a session.
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTE_TEMPLATE_APPLIED';
