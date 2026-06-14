-- Sprint 48 — demo showcase client.
--
-- A trialing therapist can seed (and one-click remove) a clearly-badged
-- "Example" client with a complete, signed, measured arc — intake +
-- five treatment sessions, a confirmed diagnosis + plan, a PHQ-9 trend
-- of 18 -> 14 -> 9 -> 4 (reliable improvement + remission), a therapy
-- script, and a shared progress report — so the Journey hub, the
-- reliable-change verdict, and the client-facing Progress Report are
-- visible in minute one without recording six real sessions.
--
-- 1. clients.isDemo — flags the fabricated client. Defaults false so
--    every existing row keeps its meaning with no backfill. Demo rows
--    are excluded from session/metric counts, competency rollups, the
--    Klara practice snapshot, and (Sprint 53) the trial session cap.
-- 2. DEMO_CLIENT_CREATED / DEMO_CLIENT_REMOVED — audit actions the
--    onboarding/demo-client route writes on seed and teardown.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "clients_psychologistId_isDemo_idx"
  ON "clients" ("psychologistId", "isDemo");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEMO_CLIENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEMO_CLIENT_REMOVED';
