-- TS7.5 — audited undo for a mis-tapped no-show. Idempotent (replay-safe).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_NO_SHOW_UNDONE';
