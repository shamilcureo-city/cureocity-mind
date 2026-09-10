-- Additive continuity only: no messages are sent and no historical rows are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "session_agreements" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);
ALTER TABLE "session_agreements" ADD COLUMN IF NOT EXISTS "retirementReason" TEXT;
ALTER TABLE "exercise_assignments" ADD COLUMN IF NOT EXISTS "sourceAgreementId" TEXT;
ALTER TABLE "exercise_assignments" ADD COLUMN IF NOT EXISTS "sourceAgreementRevision" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "exercise_assignment_agreement_revision_key"
ON "exercise_assignments" ("sourceAgreementId", "sourceAgreementRevision");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_assignment_agreement_fkey' AND conrelid = 'exercise_assignments'::regclass) THEN
    ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignment_agreement_fkey"
    FOREIGN KEY ("sourceAgreementId") REFERENCES "session_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
-- A provenance link cannot name another client/session even through a non-HTTP writer.
CREATE OR REPLACE FUNCTION check_agreement_homework_source() RETURNS trigger AS $$
BEGIN
  IF NEW."sourceAgreementId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "session_agreements" source
    WHERE source."id" = NEW."sourceAgreementId"
      AND source."clientId" = NEW."clientId"
      AND source."psychologistId" = NEW."psychologistId"
      AND source."sessionId" = NEW."sourceSessionId"
      AND NEW."sourceAgreementRevision" >= 0
      AND NEW."sourceAgreementRevision" <= source."revision"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Homework agreement provenance is invalid.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agreement_homework_source_guard' AND tgrelid = 'exercise_assignments'::regclass) THEN
    CREATE CONSTRAINT TRIGGER "agreement_homework_source_guard"
    AFTER INSERT OR UPDATE OF "sourceAgreementId", "sourceAgreementRevision", "sourceSessionId", "clientId", "psychologistId"
    ON "exercise_assignments" DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION check_agreement_homework_source();
  END IF;
END $$;
COMMIT;
