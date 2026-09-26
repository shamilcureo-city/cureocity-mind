-- Additive encrypted workflow storage. No existing clinical records are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SCRIBE_WORKSPACE_UPDATED';

CREATE TABLE IF NOT EXISTS "scribe_workspace_records" (
  "id" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "clientId" TEXT,
  "sessionId" TEXT,
  "kind" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "bodyEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scribe_workspace_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scribe_workspace_records_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "scribe_workspace_records_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scribe_workspace_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scribe_workspace_positive_revision" CHECK ("revision" > 0),
  CONSTRAINT "scribe_workspace_kind" CHECK ("kind" IN ('shortcut', 'note_style', 'intake', 'task', 'report', 'instructions')),
  CONSTRAINT "scribe_workspace_scope" CHECK (
    ("kind" IN ('shortcut', 'note_style') AND "clientId" IS NULL AND "sessionId" IS NULL)
    OR ("kind" IN ('intake', 'task', 'report', 'instructions') AND "clientId" IS NOT NULL)
  ),
  CONSTRAINT "scribe_workspace_encrypted_body" CHECK (length("bodyEncrypted") BETWEEN 1 AND 6000000)
);
CREATE INDEX IF NOT EXISTS "scribe_workspace_records_psychologistId_kind_updatedAt_idx" ON "scribe_workspace_records" ("psychologistId", "kind", "updatedAt");
CREATE INDEX IF NOT EXISTS "scribe_workspace_records_clientId_idx" ON "scribe_workspace_records" ("clientId");
CREATE INDEX IF NOT EXISTS "scribe_workspace_records_sessionId_idx" ON "scribe_workspace_records" ("sessionId");

CREATE OR REPLACE FUNCTION check_scribe_workspace_record() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR
    NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId" OR
    NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
    NEW."sessionId" IS DISTINCT FROM OLD."sessionId" OR
    NEW."kind" IS DISTINCT FROM OLD."kind" OR
    NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
    NEW."revision" <> OLD."revision" + 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Workspace identity is immutable and revisions must advance by one.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "psychologists" p WHERE p."id" = NEW."psychologistId"
      AND p."vertical" = 'DOCTOR' AND p."deletedAt" IS NULL
  ) OR (NEW."clientId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "clients" c WHERE c."id" = NEW."clientId"
      AND c."psychologistId" = NEW."psychologistId" AND c."deletedAt" IS NULL
  )) OR (NEW."sessionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sessions" s WHERE s."id" = NEW."sessionId"
      AND s."clientId" = NEW."clientId" AND s."psychologistId" = NEW."psychologistId"
  )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Workspace patient or encounter ownership is invalid.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_scribe_workspace_parent() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    IF (NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId")
      AND EXISTS (SELECT 1 FROM "scribe_workspace_records" r WHERE r."sessionId" = OLD."id") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An encounter with workspace records cannot be reassigned.';
    END IF;
  ELSE
    IF NEW."psychologistId" IS DISTINCT FROM OLD."psychologistId"
      AND EXISTS (SELECT 1 FROM "scribe_workspace_records" r WHERE r."clientId" = OLD."id") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A patient with workspace records cannot be reassigned.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scribe_workspace_record_guard' AND tgrelid = 'scribe_workspace_records'::regclass) THEN
    CREATE TRIGGER "scribe_workspace_record_guard" BEFORE INSERT OR UPDATE ON "scribe_workspace_records"
      FOR EACH ROW EXECUTE FUNCTION check_scribe_workspace_record();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scribe_workspace_session_guard' AND tgrelid = 'sessions'::regclass) THEN
    CREATE TRIGGER "scribe_workspace_session_guard" BEFORE UPDATE OF "clientId", "psychologistId" ON "sessions"
      FOR EACH ROW EXECUTE FUNCTION protect_scribe_workspace_parent();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'scribe_workspace_client_guard' AND tgrelid = 'clients'::regclass) THEN
    CREATE TRIGGER "scribe_workspace_client_guard" BEFORE UPDATE OF "psychologistId" ON "clients"
      FOR EACH ROW EXECUTE FUNCTION protect_scribe_workspace_parent();
  END IF;
END $$;
COMMIT;
