-- Sprint 56 (Lever 4 #5) — post-lapse dunning.
-- Append-only audit verb; idempotent. No table changes (the cron dedupes
-- off the audit log, same as renewal reminders).

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_DUNNING_SENT';
