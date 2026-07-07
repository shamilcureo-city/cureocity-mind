-- Sprint DS11.3 — Session.captureMode: how a doctor consult was captured
-- (LIVE | DICTATE | UPLOAD). Written at capture start; null for therapist
-- sessions and pre-DS11 rows.
--
-- Idempotent (safe to replay after a P3009 self-heal).
DO $$ BEGIN CREATE TYPE "CaptureMode" AS ENUM ('LIVE', 'DICTATE', 'UPLOAD');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "captureMode" "CaptureMode";
