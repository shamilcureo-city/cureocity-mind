-- PC2 — super-admin console.
-- New audit actions for account-lifecycle + Care-waitlist operations, and
-- two columns on the Care waitlist so an entry can be marked invited (kept
-- for the record) rather than only deleted. All DDL guarded / replay-safe.

-- New AuditAction enum values (idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_ACCOUNT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TRIAL_CAP_ADJUSTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_WAITLIST_INVITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_WAITLIST_REMOVED';

-- Care waitlist: invited marker + free-text notes.
ALTER TABLE "care_waitlist_entries" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
ALTER TABLE "care_waitlist_entries" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "care_waitlist_entries_invitedAt_createdAt_idx"
  ON "care_waitlist_entries" ("invitedAt", "createdAt");
