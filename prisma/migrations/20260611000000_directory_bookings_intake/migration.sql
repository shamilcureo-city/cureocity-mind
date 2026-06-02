-- Sprint 12: public directory + bookings + intake submissions.

ALTER TABLE "psychologists"
  ADD COLUMN "headline" TEXT,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "modalities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "yearsOfExperience" INTEGER,
  ADD COLUMN "locationCity" TEXT,
  ADD COLUMN "locationProvince" TEXT,
  ADD COLUMN "sessionFeeInr" INTEGER,
  ADD COLUMN "isAcceptingNewClients" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX "psychologists_isAcceptingNewClients_idx"
  ON "psychologists" ("isAcceptingNewClients");

CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "bookings" (
  "id"           TEXT NOT NULL,
  "therapistId"  TEXT NOT NULL,
  "patientName"  TEXT NOT NULL,
  "patientEmail" TEXT NOT NULL,
  "patientPhone" TEXT NOT NULL,
  "preferredAt"  TIMESTAMP(3) NOT NULL,
  "message"      TEXT,
  "status"       "BookingStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "resolvedAt"   TIMESTAMP(3),

  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bookings_therapistId_status_idx" ON "bookings" ("therapistId", "status");
CREATE INDEX "bookings_status_createdAt_idx" ON "bookings" ("status", "createdAt");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_therapistId_fkey"
  FOREIGN KEY ("therapistId") REFERENCES "psychologists"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "IntakeUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "IntakeMode"    AS ENUM ('IN_PERSON', 'ONLINE', 'EITHER');
CREATE TYPE "IntakeStatus"  AS ENUM ('NEW', 'REVIEWED', 'MATCHED', 'CLOSED');

CREATE TABLE "intake_submissions" (
  "id"                 TEXT NOT NULL,
  "patientName"        TEXT NOT NULL,
  "patientEmail"       TEXT NOT NULL,
  "patientPhone"       TEXT NOT NULL,
  "concerns"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"              TEXT,
  "preferredModality"  TEXT,
  "preferredLanguage"  TEXT,
  "mode"               "IntakeMode" NOT NULL DEFAULT 'EITHER',
  "urgency"            "IntakeUrgency" NOT NULL DEFAULT 'MEDIUM',
  "status"             "IntakeStatus" NOT NULL DEFAULT 'NEW',
  "assignedTherapistId" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "matchedAt"          TIMESTAMP(3),

  CONSTRAINT "intake_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intake_submissions_status_createdAt_idx" ON "intake_submissions" ("status", "createdAt");
CREATE INDEX "intake_submissions_assignedTherapistId_idx" ON "intake_submissions" ("assignedTherapistId");

ALTER TABLE "intake_submissions"
  ADD CONSTRAINT "intake_submissions_assignedTherapistId_fkey"
  FOREIGN KEY ("assignedTherapistId") REFERENCES "psychologists"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit-action enum values for the new actions.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BOOKING_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INTAKE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INTAKE_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INTAKE_MATCHED';
