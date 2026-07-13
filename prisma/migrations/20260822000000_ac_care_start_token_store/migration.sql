-- Cureocity Care — move the single-use live start-token store onto the
-- CareSession row (from the per-instance in-memory map / unwired Redis).
-- Makes the redeem check correct across every serverless instance with no
-- extra infra. Idempotent (safe to replay — the P3009 self-heal contract).

ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "startTokenHash" TEXT;
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "startTokenExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "care_sessions_startTokenHash_idx" ON "care_sessions" ("startTokenHash");
