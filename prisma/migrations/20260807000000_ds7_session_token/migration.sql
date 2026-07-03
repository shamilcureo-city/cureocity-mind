-- Sprint DS7 — OPD token queue (the zero-click clinic flow).
--
-- Adds Session.tokenNumber: the per-clinic-day OPD token, auto-assigned
-- server-side at session-create for the DOCTOR vertical. Nullable so
-- therapist rows + anything created before DS7 simply carry no token.
--
-- Idempotent per CLAUDE.md §4 (guarded DDL — safe to replay under the
-- P3009 self-heal): ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "tokenNumber" INTEGER;

-- The clinic-queue read: today's sessions for a doctor, ordered by token.
CREATE INDEX IF NOT EXISTS "sessions_psychologistId_scheduledAt_tokenNumber_idx"
  ON "sessions" ("psychologistId", "scheduledAt", "tokenNumber");
