-- Sprint DS3 — live copilot suggestion lifecycle audit actions.
-- Guarded / idempotent so a re-run or the P3009 self-heal is safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIVE_SUGGESTION_SHOWN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIVE_SUGGESTION_ACTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIVE_SUGGESTION_DISMISSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIVE_SUGGESTION_AUTORESOLVED';
