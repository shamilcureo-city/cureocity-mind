-- Sprint DS0 — live-copilot per-consult metering.
-- Every statement is guarded / idempotent so a re-run or the P3009 self-heal
-- (scripts/vercel-db-setup.sh) is safe. See CLAUDE.md §4 "Per-sprint prisma
-- migrations".

-- Audit action for persisting a live consult's meter (relayed from the gateway).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LIVE_CONSULT_METERED';

-- One row per live consult: token / cost / latency rollup. Telemetry only
-- (scalar keys, no FK) so the whole CREATE is skipped cleanly on replay.
CREATE TABLE IF NOT EXISTS "live_consult_metrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "windows" INTEGER NOT NULL,
    "pass1Calls" INTEGER NOT NULL,
    "pass2Calls" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costInr" DECIMAL(10,4) NOT NULL,
    "transcriptP50Ms" INTEGER NOT NULL,
    "transcriptP95Ms" INTEGER NOT NULL,
    "noteP50Ms" INTEGER NOT NULL,
    "noteP95Ms" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "live_consult_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "live_consult_metrics_sessionId_idx"
    ON "live_consult_metrics" ("sessionId");

CREATE INDEX IF NOT EXISTS "live_consult_metrics_psychologistId_createdAt_idx"
    ON "live_consult_metrics" ("psychologistId", "createdAt");
