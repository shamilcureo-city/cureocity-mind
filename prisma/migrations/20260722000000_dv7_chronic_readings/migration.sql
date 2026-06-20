-- Sprint DV7 — chronic-disease readings (the moat).
-- New ChronicMeasure enum + `clinical_readings` time-series table, plus
-- append-only audit + share-artefact enum values. See
-- docs/DOCTOR_VERTICAL.md §9, docs/DOCTOR_VERTICAL_SPRINTS.md DV7.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ChronicMeasure" AS ENUM ('BP', 'HBA1C', 'FBS', 'LDL', 'WEIGHT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "clinical_readings" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "sessionId" TEXT,
  "measure" "ChronicMeasure" NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "valueSecondary" DOUBLE PRECISION,
  "unit" TEXT NOT NULL,
  "takenAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinical_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clinical_readings_clientId_measure_takenAt_idx" ON "clinical_readings"("clientId", "measure", "takenAt");
CREATE INDEX IF NOT EXISTS "clinical_readings_psychologistId_idx" ON "clinical_readings"("psychologistId");
CREATE INDEX IF NOT EXISTS "clinical_readings_sessionId_idx" ON "clinical_readings"("sessionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "clinical_readings" ADD CONSTRAINT "clinical_readings_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_readings" ADD CONSTRAINT "clinical_readings_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum — chronic audit actions (append-only, idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_READING_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_CHRONIC_REPORT_SHARED';

-- AlterEnum — chronic progress-report share artefact (append-only, idempotent).
ALTER TYPE "PatientShareArtefactType" ADD VALUE IF NOT EXISTS 'CHRONIC_PROGRESS_REPORT';
