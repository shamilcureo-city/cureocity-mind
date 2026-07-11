-- Sprint TS5 — the live therapy copilot pass.
-- PASS_12_THERAPY_REASONING GeminiPass enum value, so the gateway's
-- therapy-reasoning call-log rows persist alongside the doctor passes.
-- Idempotent (safe to replay) per the migration convention.

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_12_THERAPY_REASONING';
