-- Sprint 56 — billing renewal reminders.
--
-- Append-only enum addition. `ADD VALUE IF NOT EXISTS` keeps re-runs
-- idempotent. No table changes: the cron's idempotency check reads the
-- audit log directly (metadata.day + metadata.paidThroughAtMs is the
-- dedupe key).

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_REMINDER_SENT';
