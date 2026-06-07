-- Sprint 20 Phase 3 — Treatment episodes + discharge.
--
-- Adds a durable TreatmentEpisode record so the journey arc has a real
-- terminal state (Discharged / Transferred) instead of a purely derived
-- "Discharge ready". A new episode is ensured OPEN when a session is
-- created with no active episode; discharge closes it. A returning
-- client starts a fresh episode.
--
-- Two new AuditAction values track the lifecycle.

-- ---------------------------------------------------------------------------
-- TreatmentEpisodeStatus enum + treatment_episodes table.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE "TreatmentEpisodeStatus" AS ENUM ('OPEN', 'DISCHARGED', 'TRANSFERRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "treatment_episodes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "status" "TreatmentEpisodeStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "outcomeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_episodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "treatment_episodes_clientId_openedAt_idx"
    ON "treatment_episodes" ("clientId", "openedAt");
CREATE INDEX IF NOT EXISTS "treatment_episodes_clientId_status_idx"
    ON "treatment_episodes" ("clientId", "status");

DO $$ BEGIN
    ALTER TABLE "treatment_episodes"
        ADD CONSTRAINT "treatment_episodes_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "clients" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- AuditAction additions.
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TREATMENT_EPISODE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TREATMENT_EPISODE_CLOSED';
