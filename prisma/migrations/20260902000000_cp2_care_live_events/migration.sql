-- CP2 — the Care live structure engine's persisted work record.
-- CareLiveEvent: one row per silent tool signal from the live session
-- (phase marks, key moments, worksheet fields, homework-as-agreed),
-- idempotent by (careSessionId, seq). Plus the four CP2 audit actions.
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

CREATE TABLE IF NOT EXISTS "care_live_events" (
    "id" TEXT NOT NULL,
    "careSessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "atMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_live_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "care_live_events_careSessionId_seq_key"
    ON "care_live_events"("careSessionId", "seq");

CREATE INDEX IF NOT EXISTS "care_live_events_careSessionId_createdAt_idx"
    ON "care_live_events"("careSessionId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "care_live_events"
        ADD CONSTRAINT "care_live_events_careSessionId_fkey"
        FOREIGN KEY ("careSessionId") REFERENCES "care_sessions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_LIVE_AGENDA_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_LIVE_MOMENT_LOGGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_LIVE_HOMEWORK_AGREED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_LIVE_EVENT_RECORDED';
