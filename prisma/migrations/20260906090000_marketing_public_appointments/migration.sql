-- Marketing V1 — public therapist pages + real-slot booking.
-- Guarded DDL throughout (P3009 self-heal replays migrations).

-- Psychologist: slug + publish state + FAQs
ALTER TABLE "psychologists" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
ALTER TABLE "psychologists" ADD COLUMN IF NOT EXISTS "profilePublishedAt" TIMESTAMP(3);
ALTER TABLE "psychologists" ADD COLUMN IF NOT EXISTS "profileFaqs" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "psychologists_publicSlug_key" ON "psychologists"("publicSlug");

-- AppointmentStatus enum
DO $$ BEGIN CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AvailabilityRule
CREATE TABLE IF NOT EXISTS "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AvailabilityRule_psychologistId_weekday_idx" ON "AvailabilityRule"("psychologistId", "weekday");

-- Booking
CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "patientNameEncrypted" TEXT NOT NULL,
    "patientPhoneEncrypted" TEXT NOT NULL,
    "patientEmailEncrypted" TEXT,
    "concernEncrypted" TEXT,
    "clientId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Appointment_psychologistId_status_startAt_idx" ON "Appointment"("psychologistId", "status", "startAt");
CREATE INDEX IF NOT EXISTS "Appointment_psychologistId_startAt_idx" ON "Appointment"("psychologistId", "startAt");

-- Audit actions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPIST_PROFILE_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPIST_PROFILE_UNPUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AVAILABILITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_DECLINED';
