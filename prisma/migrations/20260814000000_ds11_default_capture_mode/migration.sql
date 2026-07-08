-- Sprint DS11.7-fu — a doctor's preferred capture pipeline for a new consult.
-- NULL keeps the product default (LIVE). Idempotent: the column add is guarded
-- so the P3009 self-heal (rollback + replay) never trips "already exists".
-- The "CaptureMode" enum already exists (20260811000000_ds11_capture_mode).
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "defaultCaptureMode" "CaptureMode";
