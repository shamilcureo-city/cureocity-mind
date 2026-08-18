-- One finalized live meter and one aggregate spend ledger entry per Session.
-- Keep the earliest legacy record deterministically before installing the
-- uniqueness backstop. The route's Client lock + upsert handles future races.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sessionId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS row_number
  FROM "live_consult_metrics"
)
DELETE FROM "live_consult_metrics" metric
USING ranked
WHERE metric."id" = ranked."id"
  AND ranked.row_number > 1;

-- Legacy retries could also have duplicated the aggregate Gemini spend row.
-- This signature is reserved to the live-consult rollup, so reasoning calls
-- with other prompt versions remain untouched.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sessionId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS row_number
  FROM "gemini_call_logs"
  WHERE "sessionId" IS NOT NULL
    AND "promptVersion" = 'LIVE_CONSULT_ROLLUP_V1'
)
DELETE FROM "gemini_call_logs" call_log
USING ranked
WHERE call_log."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "LiveConsultMetric_sessionId_key"
  ON "live_consult_metrics"("sessionId");
