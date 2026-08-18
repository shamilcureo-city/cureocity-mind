-- Reconcile PostgreSQL-truncated index names from the superseded preview
-- capability migration with Prisma's generated 63-character identifiers.
-- Fresh databases already have the target names, so each block is a no-op.
DO $$ BEGIN
  IF to_regclass('"practitioner_credentials_kind_registrationNumber_issuingAuthori"') IS NOT NULL
     AND to_regclass('"practitioner_credentials_kind_registrationNumber_issuingAut_key"') IS NULL THEN
    ALTER INDEX "practitioner_credentials_kind_registrationNumber_issuingAuthori"
      RENAME TO "practitioner_credentials_kind_registrationNumber_issuingAut_key";
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('"practitioner_capability_grants_psychologistId_capability_source"') IS NOT NULL
     AND to_regclass('"practitioner_capability_grants_psychologistId_capability_so_key"') IS NULL THEN
    ALTER INDEX "practitioner_capability_grants_psychologistId_capability_source"
      RENAME TO "practitioner_capability_grants_psychologistId_capability_so_key";
  END IF;
END $$;
