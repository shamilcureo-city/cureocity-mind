-- Latest cumulative usage per actual gateway connection. No historical backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_USAGE_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSION_USAGE_REPORTED';

CREATE TABLE IF NOT EXISTS "session_usage_connections" (
  "connectionId" UUID NOT NULL,
  "sessionId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "vertical" TEXT NOT NULL,
  "backend" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "lastPayloadHash" TEXT,
  "lastReceipt" JSONB,
  "costInr" DECIMAL(14,4),
  CONSTRAINT "session_usage_connections_pkey" PRIMARY KEY ("connectionId"),
  CONSTRAINT "session_usage_session_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "session_usage_owner_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_usage_client_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "session_usage_valid_identity" CHECK ("vertical" IN ('THERAPIST', 'DOCTOR') AND "backend" IN ('vertex', 'mock')),
  CONSTRAINT "session_usage_valid_state" CHECK ("state" IN ('OPEN', 'FINAL_REPORTED', 'INCOMPLETE')),
  CONSTRAINT "session_usage_nonnegative_sequence" CHECK ("lastSequence" >= 0),
  CONSTRAINT "session_usage_nonnegative_cost" CHECK ("costInr" IS NULL OR "costInr" >= 0),
  CONSTRAINT "session_usage_receipt_presence" CHECK (
    ("lastSequence" = 0 AND "lastPayloadHash" IS NULL AND "lastReceipt" IS NULL AND "costInr" IS NULL AND "state" = 'OPEN' AND "endedAt" IS NULL)
    OR ("lastSequence" > 0 AND "lastPayloadHash" IS NOT NULL AND "lastPayloadHash" ~ '^[a-f0-9]{64}$' AND "lastReceipt" IS NOT NULL AND "costInr" IS NOT NULL)
  ),
  CONSTRAINT "session_usage_terminal_time" CHECK (("state" = 'OPEN' AND "endedAt" IS NULL) OR ("state" <> 'OPEN' AND "endedAt" IS NOT NULL AND "endedAt" >= "startedAt")),
  CONSTRAINT "session_usage_receipt_cost_matches" CHECK (
    "lastReceipt" IS NULL OR (
      jsonb_typeof("lastReceipt") = 'object'
      AND "lastReceipt"->>'type' = 'RECEIPT'
      AND "lastReceipt"->>'version' = '1'
      AND "lastReceipt"->>'domain' = 'CUREOCITY_LIVE_USAGE_V1'
      AND "lastReceipt"->>'connectionId' = "connectionId"::text
      AND "lastReceipt"->>'sessionId' = "sessionId"
      AND "lastReceipt"->>'psychologistId' = "psychologistId"
      AND "lastReceipt"->>'vertical' = "vertical"
      AND ("lastReceipt"->>'sequence')::integer = "lastSequence"
      AND "lastReceipt"->>'state' = "state"
      AND ("lastReceipt"->'totals'->>'costInr')::decimal = "costInr"
      AND ("lastReceipt"->'totals'->>'transcriptionInr')::decimal
        + ("lastReceipt"->'totals'->>'notesInr')::decimal
        + ("lastReceipt"->'totals'->>'reasoningInr')::decimal = "costInr"
      AND ("backend" <> 'mock' OR "costInr" = 0)
    ) IS TRUE
  )
);
CREATE INDEX IF NOT EXISTS "session_usage_owner_started_idx" ON "session_usage_connections" ("psychologistId", "startedAt");
CREATE INDEX IF NOT EXISTS "session_usage_session_registered_idx" ON "session_usage_connections" ("sessionId", "registeredAt");
CREATE INDEX IF NOT EXISTS "session_usage_client_idx" ON "session_usage_connections" ("clientId");

CREATE OR REPLACE FUNCTION check_session_usage_owner() RETURNS trigger AS $$
DECLARE
  usage_field TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "sessions" s JOIN "clients" c ON c."id" = s."clientId"
    WHERE s."id" = NEW."sessionId" AND s."clientId" = NEW."clientId"
      AND s."psychologistId" = NEW."psychologistId"
      AND c."psychologistId" = NEW."psychologistId" AND c."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage visit ownership is invalid.';
  END IF;
  IF NEW."lastReceipt" IS NOT NULL THEN
    IF octet_length(NEW."lastReceipt"::text) > 65536 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage receipt is too large.';
    END IF;
    FOREACH usage_field IN ARRAY ARRAY['inputTokens','outputTokens','pass1Calls','pass2Calls','reasoningCalls','unknownCalls'] LOOP
      IF (jsonb_typeof(NEW."lastReceipt"->'totals'->usage_field) = 'number'
          AND NEW."lastReceipt"->'totals'->>usage_field ~ '^[0-9]+$'
          AND (NEW."lastReceipt"->'totals'->>usage_field)::numeric <= 2147483647) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage counters must be bounded nonnegative integers.';
      END IF;
    END LOOP;
    FOREACH usage_field IN ARRAY ARRAY['costInr','transcriptionInr','notesInr','reasoningInr'] LOOP
      IF (jsonb_typeof(NEW."lastReceipt"->'totals'->usage_field) = 'string'
          AND NEW."lastReceipt"->'totals'->>usage_field ~ '^(0|[1-9][0-9]{0,9})\.[0-9]{4}$') IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage costs must be bounded canonical decimals.';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."connectionId" IS DISTINCT FROM OLD."connectionId"
       OR NEW."sessionId" IS DISTINCT FROM OLD."sessionId"
       OR NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId"
       OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
       OR NEW."vertical" IS DISTINCT FROM OLD."vertical"
       OR NEW."backend" IS DISTINCT FROM OLD."backend"
       OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
       OR NEW."registeredAt" IS DISTINCT FROM OLD."registeredAt" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage connection identity is immutable.';
    END IF;
    IF NEW."lastSequence" <= OLD."lastSequence" OR NEW."costInr" < OLD."costInr"
       OR OLD."state" = 'FINAL_REPORTED'
       OR (OLD."state" = 'INCOMPLETE' AND NEW."state" <> 'INCOMPLETE')
       OR (OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt")
       OR (OLD."lastReceipt" IS NOT NULL AND NEW."lastReceipt"->>'usageBasis' IS DISTINCT FROM OLD."lastReceipt"->>'usageBasis') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage receipts must advance without reducing evidence.';
    END IF;
    IF OLD."lastReceipt" IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(ARRAY['inputTokens','outputTokens','pass1Calls','pass2Calls','reasoningCalls','unknownCalls','transcriptionInr','notesInr','reasoningInr']) AS field
      WHERE (NEW."lastReceipt"->'totals'->>field)::decimal < (OLD."lastReceipt"->'totals'->>field)::decimal
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Usage counters cannot decrease.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_usage_visit_identity() RETURNS trigger AS $$
BEGIN
  IF (NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId")
     AND EXISTS (SELECT 1 FROM "session_usage_connections" u WHERE u."sessionId" = OLD."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Metered visit ownership cannot be reassigned.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'session_usage_owner_guard' AND tgrelid = 'session_usage_connections'::regclass) THEN
    CREATE TRIGGER "session_usage_owner_guard" BEFORE INSERT OR UPDATE ON "session_usage_connections"
    FOR EACH ROW EXECUTE FUNCTION check_session_usage_owner();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'session_usage_visit_identity_guard' AND tgrelid = 'sessions'::regclass) THEN
    CREATE TRIGGER "session_usage_visit_identity_guard" BEFORE UPDATE OF "clientId", "psychologistId" ON "sessions"
    FOR EACH ROW EXECUTE FUNCTION protect_usage_visit_identity();
  END IF;
END $$;
COMMIT;
