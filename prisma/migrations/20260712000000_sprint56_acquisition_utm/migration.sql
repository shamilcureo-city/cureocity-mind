-- Sprint 56 (Lever 3a) — acquisition attribution at signup.
--
-- Add a nullable JSON column to psychologists for { utm_source,
-- utm_medium, utm_campaign, referrer }. Idempotent; nullable so the
-- column ships safely even on a DB with existing rows.

ALTER TABLE "psychologists"
  ADD COLUMN IF NOT EXISTS "acquisitionUtm" JSONB;
