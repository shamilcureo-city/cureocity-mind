-- Immutable, encrypted clinician-authored care context. No inferred clinical decisions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MIND_CARE_RECORD_SAVED';
CREATE TABLE IF NOT EXISTS "client_mind_care_records" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "operationId" TEXT NOT NULL,
  "bodyEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_mind_care_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_mind_care_records_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_mind_care_records_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mind_care_record_positive_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "mind_care_record_client_version_key" ON "client_mind_care_records" ("clientId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "mind_care_record_client_operation_key" ON "client_mind_care_records" ("clientId", "operationId");
CREATE INDEX IF NOT EXISTS "mind_care_record_owner_client_idx" ON "client_mind_care_records" ("psychologistId", "clientId");
CREATE OR REPLACE FUNCTION check_mind_care_record_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "clients" c WHERE c."id" = NEW."clientId" AND c."psychologistId" = NEW."psychologistId" AND c."deletedAt" IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Care record client ownership is invalid.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mind_care_record_owner_guard' AND tgrelid = 'client_mind_care_records'::regclass) THEN
    CREATE CONSTRAINT TRIGGER "mind_care_record_owner_guard"
    AFTER INSERT OR UPDATE OF "clientId", "psychologistId"
    ON "client_mind_care_records" DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION check_mind_care_record_owner();
  END IF;
END $$;
COMMIT;
