-- Sprint 39: multi-tenant clinics foundation (additive; Phase 1).

CREATE TYPE "ClinicKind" AS ENUM ('SOLO', 'GROUP');
CREATE TYPE "ClinicRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "clinics" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "kind"      "ClinicKind" NOT NULL DEFAULT 'SOLO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinic_memberships" (
  "id"             TEXT NOT NULL,
  "clinicId"       TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "role"           "ClinicRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clinic_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinic_memberships_clinicId_psychologistId_key"
  ON "clinic_memberships" ("clinicId", "psychologistId");
CREATE INDEX "clinic_memberships_psychologistId_idx"
  ON "clinic_memberships" ("psychologistId");

ALTER TABLE "clinic_memberships"
  ADD CONSTRAINT "clinic_memberships_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_memberships"
  ADD CONSTRAINT "clinic_memberships_psychologistId_fkey"
  FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit actions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINIC_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINIC_MEMBER_ADDED';

-- Backfill: every existing therapist becomes OWNER of an auto-created
-- personal SOLO clinic. gen_random_uuid() is built-in on PG13+ (Neon).
DO $$
DECLARE
  p   RECORD;
  cid TEXT;
BEGIN
  FOR p IN SELECT id, "fullName" FROM "psychologists" WHERE "deletedAt" IS NULL LOOP
    cid := gen_random_uuid()::text;
    INSERT INTO "clinics" ("id", "name", "kind", "createdAt", "updatedAt")
      VALUES (cid, COALESCE(NULLIF(p."fullName", ''), 'My practice'), 'SOLO', now(), now());
    INSERT INTO "clinic_memberships" ("id", "clinicId", "psychologistId", "role", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, cid, p.id, 'OWNER', now(), now());
  END LOOP;
END $$;
