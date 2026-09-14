-- Append-only, encrypted preparation for an exact visit. No automatic legacy import.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MIND_SESSION_PREPARATION_SAVED';

CREATE TABLE IF NOT EXISTS "mind_session_preparations" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "operationId" TEXT NOT NULL,
  "bodyEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mind_session_preparations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mind_preparation_session_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mind_preparation_owner_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mind_preparation_positive_revision" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "mind_preparation_session_revision_key" ON "mind_session_preparations" ("sessionId", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "mind_preparation_session_operation_key" ON "mind_session_preparations" ("sessionId", "operationId");
CREATE INDEX IF NOT EXISTS "mind_preparation_owner_session_idx" ON "mind_session_preparations" ("psychologistId", "sessionId");

CREATE OR REPLACE FUNCTION check_mind_session_preparation_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "sessions" s
    JOIN "clients" c ON c."id" = s."clientId"
    WHERE s."id" = NEW."sessionId"
      AND s."psychologistId" = NEW."psychologistId"
      AND c."psychologistId" = NEW."psychologistId"
      AND c."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Preparation visit ownership is invalid.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replacements and clears append a revision. Erasure remains an explicit DELETE.
CREATE OR REPLACE FUNCTION reject_mind_session_preparation_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Preparation revisions are immutable.';
END;
$$ LANGUAGE plpgsql;

-- Once preparation exists, changing the parent visit's client/tenant would move
-- clinical history to another person. App writers lock Client then Session;
-- this guard also rejects later direct parent reassignment.
CREATE OR REPLACE FUNCTION protect_mind_preparation_visit_identity() RETURNS trigger AS $$
BEGIN
  IF (NEW."clientId" IS DISTINCT FROM OLD."clientId"
      OR NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId")
     AND EXISTS (SELECT 1 FROM "mind_session_preparations" p WHERE p."sessionId" = OLD."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Prepared visit ownership cannot be reassigned.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mind_preparation_owner_guard' AND tgrelid = 'mind_session_preparations'::regclass) THEN
    CREATE CONSTRAINT TRIGGER "mind_preparation_owner_guard"
    AFTER INSERT ON "mind_session_preparations" DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION check_mind_session_preparation_owner();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mind_preparation_immutable_guard' AND tgrelid = 'mind_session_preparations'::regclass) THEN
    CREATE TRIGGER "mind_preparation_immutable_guard"
    BEFORE UPDATE ON "mind_session_preparations"
    FOR EACH ROW EXECUTE FUNCTION reject_mind_session_preparation_update();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mind_preparation_visit_identity_guard' AND tgrelid = 'sessions'::regclass) THEN
    CREATE TRIGGER "mind_preparation_visit_identity_guard"
    BEFORE UPDATE OF "clientId", "psychologistId" ON "sessions"
    FOR EACH ROW EXECUTE FUNCTION protect_mind_preparation_visit_identity();
  END IF;
END $$;
COMMIT;
