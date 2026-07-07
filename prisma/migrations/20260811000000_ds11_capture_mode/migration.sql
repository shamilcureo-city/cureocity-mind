-- Sprint DS11.3 — Session.captureMode: how a doctor consult was captured
-- (LIVE | DICTATE | UPLOAD). Written at capture start; null for therapist
-- sessions and pre-DS11 rows.
--
-- Idempotent (safe to replay after a P3009 self-heal).
DO $$ BEGIN CREATE TYPE "CaptureMode" AS ENUM ('LIVE', 'DICTATE', 'UPLOAD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The Session model is @@map("sessions"); the original DDL referenced the
-- unmapped "Session" table which does not exist, so `prisma migrate deploy`
-- failed with P3018 (relation "Session" does not exist) and wedged every fresh
-- deploy. Fixed in place because the migration never applied successfully
-- anywhere (nothing to preserve a checksum for).
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "captureMode" "CaptureMode";
