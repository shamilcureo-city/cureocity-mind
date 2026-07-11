-- AUD1 — meter + rate-limit the practice-assistant chat.
-- Idempotent (safe to replay per the P3009 self-heal convention).

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'ASSISTANT_CHAT';

ALTER TABLE "gemini_call_logs" ADD COLUMN IF NOT EXISTS "psychologistId" TEXT;

CREATE INDEX IF NOT EXISTS "gemini_call_logs_psychologistId_createdAt_idx"
  ON "gemini_call_logs"("psychologistId", "createdAt");
