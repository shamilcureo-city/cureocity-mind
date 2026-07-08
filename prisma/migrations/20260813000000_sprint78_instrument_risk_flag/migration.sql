-- CLIN-1 — persist the instrument safety bit on the record. Previously a
-- self-check-in endorsing PHQ-9 item 9 (suicidality) wrote only an audit row;
-- the risk bit was not queryable, so it never reached the therapist's crisis
-- pathway. `riskFlagged` makes it a first-class, queryable column.
--
-- Idempotent (safe to replay after a P3009 self-heal). Existing rows default
-- to false — correct, since a historical high-risk endorsement already lives
-- in the audit log and the trend, and false is the safe non-alerting default.
ALTER TABLE "instrument_responses"
  ADD COLUMN IF NOT EXISTS "riskFlagged" BOOLEAN NOT NULL DEFAULT false;

-- CLIN-1 — the immediate-therapist-alert audit action (a distinct, clinically
-- meaningful safety event: we actively notified the therapist of a crisis).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPIST_CRISIS_ALERTED';
