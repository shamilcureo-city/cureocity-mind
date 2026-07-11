-- NEXT2/NEXT3 — audit actions for the stuck-generation reclaim cron and the
-- unsigned-note daily digest. Idempotent (replay-safe) per convention.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'STUCK_GENERATION_RECLAIMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UNSIGNED_NOTE_DIGEST_SENT';
