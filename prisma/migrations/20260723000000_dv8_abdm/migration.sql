-- Sprint DV8 — ABDM/ABHA/FHIR interoperability.
-- Patient ABHA address column + append-only audit-enum values
-- (idempotent), per the per-sprint migration convention. See
-- docs/DOCTOR_VERTICAL.md §11, docs/DOCTOR_VERTICAL_SPRINTS.md DV8.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "abhaAddress" TEXT;

-- AlterEnum — ABDM/ABHA/FHIR audit actions (append-only, idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCOUNTER_FHIR_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ABHA_LINKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ABDM_PRESCRIPTION_PUSHED';
