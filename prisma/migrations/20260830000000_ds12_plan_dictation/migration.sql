-- Sprint DS12 — voice-edit the plan (plan dictation).
-- New Gemini pass + the proposal audit action. Idempotent (guarded) per the
-- migration convention: safe for the P3009 self-heal to replay.

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_14_PLAN_DICTATION';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_DICTATION_PROPOSED';
