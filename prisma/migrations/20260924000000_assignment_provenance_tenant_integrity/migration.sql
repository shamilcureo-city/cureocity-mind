-- R2-05: provenance is nullable history, but any retained pointer must belong
-- to the assignment's client and psychologist. Keep the existing single-id
-- foreign keys for existence and ON DELETE SET NULL; constraint triggers add
-- the cross-column tenant invariant that Prisma cannot represent truthfully.

-- Replay-safe legacy repair runs before enforcement. This also closes the gap
-- for rows written after the original one-time cleanup but before this migration.
UPDATE "exercise_assignments" AS assignment
SET "sourceSessionId" = NULL
WHERE assignment."sourceSessionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "sessions" AS source
    WHERE source."id" = assignment."sourceSessionId"
      AND source."clientId" = assignment."clientId"
      AND source."psychologistId" = assignment."psychologistId"
  );

UPDATE "exercise_assignments" AS assignment
SET "responseShareId" = NULL
WHERE assignment."responseShareId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "patient_shares" AS share
    WHERE share."id" = assignment."responseShareId"
      AND share."clientId" = assignment."clientId"
      AND share."psychologistId" = assignment."psychologistId"
  );

CREATE OR REPLACE FUNCTION "enforce_exercise_assignment_provenance_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."sourceSessionId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "sessions" AS source
      WHERE source."id" = NEW."sourceSessionId"
        AND source."clientId" = NEW."clientId"
        AND source."psychologistId" = NEW."psychologistId"
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exercise_assignments_sourceSession_tenant_check',
      MESSAGE = 'sourceSessionId must belong to the assignment client and psychologist';
  END IF;

  IF NEW."responseShareId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "patient_shares" AS share
      WHERE share."id" = NEW."responseShareId"
        AND share."clientId" = NEW."clientId"
        AND share."psychologistId" = NEW."psychologistId"
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exercise_assignments_responseShare_tenant_check',
      MESSAGE = 'responseShareId must belong to the assignment client and psychologist';
  END IF;

  RETURN NEW;
END;
$$;

-- Protect the invariant from tenant-field changes on the referenced rows too;
-- otherwise a valid assignment could become cross-tenant without being updated.
CREATE OR REPLACE FUNCTION "enforce_session_assignment_provenance_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "exercise_assignments" AS assignment
    WHERE assignment."sourceSessionId" = NEW."id"
      AND (
        assignment."clientId" <> NEW."clientId"
        OR assignment."psychologistId" <> NEW."psychologistId"
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exercise_assignments_sourceSession_tenant_check',
      MESSAGE = 'session tenant must match referencing exercise assignments';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_patient_share_assignment_provenance_tenant"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "exercise_assignments" AS assignment
    WHERE assignment."responseShareId" = NEW."id"
      AND (
        assignment."clientId" <> NEW."clientId"
        OR assignment."psychologistId" <> NEW."psychologistId"
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'exercise_assignments_responseShare_tenant_check',
      MESSAGE = 'patient share tenant must match referencing exercise assignments';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS catalog_trigger
    JOIN pg_class AS relation ON relation.oid = catalog_trigger.tgrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_trigger.tgname = 'exercise_assignments_provenance_tenant_trigger'
      AND catalog_trigger.tgrelid = 'exercise_assignments'::regclass
      AND schema.nspname = current_schema()
      AND NOT catalog_trigger.tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER "exercise_assignments_provenance_tenant_trigger"
      AFTER INSERT OR UPDATE OF "sourceSessionId", "responseShareId", "clientId", "psychologistId"
      ON "exercise_assignments"
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION "enforce_exercise_assignment_provenance_tenant"();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS catalog_trigger
    JOIN pg_class AS relation ON relation.oid = catalog_trigger.tgrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_trigger.tgname = 'sessions_assignment_provenance_tenant_trigger'
      AND catalog_trigger.tgrelid = 'sessions'::regclass
      AND schema.nspname = current_schema()
      AND NOT catalog_trigger.tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER "sessions_assignment_provenance_tenant_trigger"
      AFTER UPDATE OF "id", "clientId", "psychologistId"
      ON "sessions"
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION "enforce_session_assignment_provenance_tenant"();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS catalog_trigger
    JOIN pg_class AS relation ON relation.oid = catalog_trigger.tgrelid
    JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE catalog_trigger.tgname = 'patient_shares_assignment_provenance_tenant_trigger'
      AND catalog_trigger.tgrelid = 'patient_shares'::regclass
      AND schema.nspname = current_schema()
      AND NOT catalog_trigger.tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER "patient_shares_assignment_provenance_tenant_trigger"
      AFTER UPDATE OF "id", "clientId", "psychologistId"
      ON "patient_shares"
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW
      EXECUTE FUNCTION "enforce_patient_share_assignment_provenance_tenant"();
  END IF;
END $$;
