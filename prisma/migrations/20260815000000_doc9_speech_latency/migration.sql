-- DOC-9 — record the HONEST speech→transcript latency on each consult metric
-- (the window-wait was excluded from transcriptP*Ms, so the meter read green
-- while the lived latency was 7–15s). Default 0 for existing rows.
--
-- Idempotent (safe to replay after a P3009 self-heal).
ALTER TABLE "live_consult_metrics"
  ADD COLUMN IF NOT EXISTS "speechToTranscriptP50Ms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "live_consult_metrics"
  ADD COLUMN IF NOT EXISTS "speechToTranscriptP95Ms" INTEGER NOT NULL DEFAULT 0;
