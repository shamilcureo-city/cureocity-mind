-- CG1 — Care measurement loop + COGS metering (docs/CARE_GROWTH_SYSTEM.md §12).
-- Cumulative Live-API token counts, relayed by the browser at session end.
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "liveTokensIn" INTEGER;
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "liveTokensOut" INTEGER;
