-- Cureocity ORBIT Sprint 2: credential-backed, explicit capabilities.
-- Additive and replay-safe: existing vertical fields and queries remain intact.

DO $$ BEGIN
  CREATE TYPE "PractitionerProfession" AS ENUM (
    'PSYCHOLOGIST', 'COUNSELLOR', 'PSYCHIATRIST', 'PHYSICIAN', 'SPECIALIST_PHYSICIAN'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PractitionerCredentialKind" AS ENUM (
    'RCI_REGISTRATION', 'NMC_REGISTRATION', 'STATE_MEDICAL_COUNCIL_REGISTRATION',
    'OTHER_CLINICAL_REGISTRATION'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PractitionerCredentialStatus" AS ENUM (
    'PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED', 'EXPIRED', 'REVOKED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PractitionerCapability" AS ENUM (
    'AMBIENT_CAPTURE', 'LIVE_ENCOUNTER', 'BEHAVIORAL_HEALTH_DOCUMENTATION',
    'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS', 'THERAPY_WORKFLOWS',
    'MEASUREMENT_BASED_CARE', 'SAFETY_PLANNING', 'PRESCRIPTION_DRAFTING',
    'PRESCRIPTION_SIGNING', 'CLINICAL_ORDERS', 'CHRONIC_CARE', 'FHIR_EXPORT',
    'ABDM_PUSH', 'PATIENT_SHARING'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CapabilityGrantSource" AS ENUM (
    'LEGACY_BACKFILL', 'VERIFIED_CREDENTIAL', 'ORGANIZATION_POLICY', 'ADMIN_OVERRIDE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "psychologists"
  ADD COLUMN IF NOT EXISTS "profession" "PractitionerProfession";

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CAPABILITY_ACCESS_DENIED';

CREATE TABLE IF NOT EXISTS "practitioner_credentials" (
  "id" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "kind" "PractitionerCredentialKind" NOT NULL,
  "registrationNumber" TEXT NOT NULL,
  "issuingAuthority" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
  "status" "PractitionerCredentialStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "verifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "practitioner_credentials_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "practitioner_credentials"
    ADD CONSTRAINT "practitioner_credentials_registrationNumber_nonblank_check"
    CHECK (btrim("registrationNumber") <> '');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "practitioner_credentials"
    ADD CONSTRAINT "practitioner_credentials_issuingAuthority_nonblank_check"
    CHECK (btrim("issuingAuthority") <> '');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "practitioner_credentials"
    ADD CONSTRAINT "practitioner_credentials_jurisdiction_nonblank_check"
    CHECK (btrim("jurisdiction") <> '');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "practitioner_credentials"
    ADD CONSTRAINT "practitioner_credentials_verified_status_timestamp_check"
    CHECK ("status" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "practitioner_capability_grants" (
  "id" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "capability" "PractitionerCapability" NOT NULL,
  "source" "CapabilityGrantSource" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "practitioner_capability_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "clinic_capability_grants" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "capability" "PractitionerCapability" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "clinic_capability_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "practitioner_credentials_kind_registrationNumber_issuingAut_key"
  ON "practitioner_credentials"("kind", "registrationNumber", "issuingAuthority");
CREATE INDEX IF NOT EXISTS "practitioner_credentials_psychologistId_status_idx"
  ON "practitioner_credentials"("psychologistId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "practitioner_capability_grants_psychologistId_capability_so_key"
  ON "practitioner_capability_grants"("psychologistId", "capability", "source");
CREATE INDEX IF NOT EXISTS "practitioner_capability_grants_psychologistId_active_idx"
  ON "practitioner_capability_grants"("psychologistId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_capability_grants_clinicId_capability_key"
  ON "clinic_capability_grants"("clinicId", "capability");
CREATE INDEX IF NOT EXISTS "clinic_capability_grants_clinicId_active_idx"
  ON "clinic_capability_grants"("clinicId", "active");

DO $$ BEGIN
  ALTER TABLE "practitioner_credentials"
    ADD CONSTRAINT "practitioner_credentials_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "practitioner_capability_grants"
    ADD CONSTRAINT "practitioner_capability_grants_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinic_capability_grants"
    ADD CONSTRAINT "clinic_capability_grants_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Preserve existing registrations as credential records. RCI registrations already carry an
-- application verification timestamp; legacy medical registrations remain pending until a
-- dedicated verifier confirms the issuing council and jurisdiction.
INSERT INTO "practitioner_credentials" (
  "id", "psychologistId", "kind", "registrationNumber", "issuingAuthority", "jurisdiction",
  "status", "verifiedAt", "createdAt", "updatedAt"
)
SELECT concat('c', substr(md5(p."id" || ':rci'), 1, 24)), p."id", 'RCI_REGISTRATION',
       NULLIF(btrim(p."rciNumber"), ''),
       'Rehabilitation Council of India', 'IN',
       CASE WHEN p."rciVerifiedAt" IS NOT NULL AND p."rciVerifiedAt" <= CURRENT_TIMESTAMP
            THEN 'VERIFIED'::"PractitionerCredentialStatus"
            ELSE 'PENDING_VERIFICATION'::"PractitionerCredentialStatus" END,
       p."rciVerifiedAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "psychologists" p
WHERE p."vertical" = 'THERAPIST' AND NULLIF(btrim(p."rciNumber"), '') IS NOT NULL
ON CONFLICT ("kind", "registrationNumber", "issuingAuthority") DO NOTHING;

INSERT INTO "practitioner_credentials" (
  "id", "psychologistId", "kind", "registrationNumber", "issuingAuthority", "jurisdiction",
  "status", "createdAt", "updatedAt"
)
SELECT concat('c', substr(md5(p."id" || ':medical'), 1, 24)), p."id", 'STATE_MEDICAL_COUNCIL_REGISTRATION',
       NULLIF(btrim(p."medicalRegNumber"), ''), 'Pending council verification', 'IN',
       'PENDING_VERIFICATION',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "psychologists" p
WHERE NULLIF(btrim(p."medicalRegNumber"), '') IS NOT NULL
ON CONFLICT ("kind", "registrationNumber", "issuingAuthority") DO NOTHING;

-- Safe compatibility backfill. This preserves current product access but never grants
-- PRESCRIPTION_SIGNING: signing requires a separately verified medical credential.
INSERT INTO "practitioner_capability_grants" (
  "id", "psychologistId", "capability", "source", "active", "grantedAt"
)
SELECT concat('c', substr(md5(p."id" || ':' || c.capability), 1, 24)), p."id",
       c.capability::"PractitionerCapability", 'LEGACY_BACKFILL', true, CURRENT_TIMESTAMP
FROM "psychologists" p
CROSS JOIN LATERAL (
  SELECT unnest(
    CASE WHEN p."vertical" = 'DOCTOR' THEN ARRAY[
      'AMBIENT_CAPTURE', 'LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS',
      'PRESCRIPTION_DRAFTING', 'CLINICAL_ORDERS', 'CHRONIC_CARE', 'PATIENT_SHARING'
    ]::text[] ELSE ARRAY[
      'AMBIENT_CAPTURE', 'BEHAVIORAL_HEALTH_DOCUMENTATION', 'CLINICAL_ANALYSIS',
      'THERAPY_WORKFLOWS', 'MEASUREMENT_BASED_CARE', 'SAFETY_PLANNING', 'PATIENT_SHARING'
    ]::text[] END
  ) AS capability
) c
ON CONFLICT ("psychologistId", "capability", "source") DO NOTHING;
