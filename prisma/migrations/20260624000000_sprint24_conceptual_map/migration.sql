-- Sprint 24 — Pass 7 Conceptual Map.
-- Adds:
--   * client_conceptual_maps table (per-client thematic graph storage)
--   * PASS_7_CONCEPTUAL_MAP value on GeminiPass enum
--   * CONCEPTUAL_MAP_GENERATED value on AuditAction enum
--
-- Fully additive + idempotent (CREATE TABLE IF NOT EXISTS,
-- ADD VALUE IF NOT EXISTS, guarded FK ADD). Safe to re-run.

ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_7_CONCEPTUAL_MAP';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONCEPTUAL_MAP_GENERATED';

CREATE TABLE IF NOT EXISTS "client_conceptual_maps" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "basedOnSessionIds" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'llm',

    CONSTRAINT "client_conceptual_maps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_conceptual_maps_clientId_supersededAt_idx"
    ON "client_conceptual_maps"("clientId", "supersededAt");

CREATE INDEX IF NOT EXISTS "client_conceptual_maps_psychologistId_generatedAt_idx"
    ON "client_conceptual_maps"("psychologistId", "generatedAt");

DO $$
BEGIN
    ALTER TABLE "client_conceptual_maps"
        ADD CONSTRAINT "client_conceptual_maps_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "client_conceptual_maps"
        ADD CONSTRAINT "client_conceptual_maps_psychologistId_fkey"
        FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
