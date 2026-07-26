-- MK2–MK6 — the marketing suite: identity fields, session modes, photo,
-- lifecycle stamps, posts, metrics, audit actions. Guarded DDL throughout.

-- MK2 — Psychologist identity fields
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "credentialsLine" TEXT;
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "pronouns" TEXT;
ALTER TABLE "Psychologist" ADD COLUMN IF NOT EXISTS "officeAddress" TEXT;

-- MK2 — per-window session mode
ALTER TABLE "AvailabilityRule" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'ONLINE';

-- MK4 — reminder stamps
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reminded24At" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reminded2At" TIMESTAMP(3);

-- MK2 — inline profile photo
CREATE TABLE IF NOT EXISTS "PsychologistPhoto" (
    "psychologistId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PsychologistPhoto_pkey" PRIMARY KEY ("psychologistId")
);

-- MK5 — profile posts
DO $$ BEGIN CREATE TYPE "ProfilePostStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ProfilePost" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topic" TEXT,
    "status" "ProfilePostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePost_psychologistId_slug_key" ON "ProfilePost"("psychologistId", "slug");
CREATE INDEX IF NOT EXISTS "ProfilePost_psychologistId_status_idx" ON "ProfilePost"("psychologistId", "status");

-- MK6 — daily funnel counters
CREATE TABLE IF NOT EXISTS "ProfileMetricDaily" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProfileMetricDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProfileMetricDaily_psychologistId_kind_day_key" ON "ProfileMetricDaily"("psychologistId", "kind", "day");
CREATE INDEX IF NOT EXISTS "ProfileMetricDaily_psychologistId_day_idx" ON "ProfileMetricDaily"("psychologistId", "day");

-- Audit actions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'APPOINTMENT_REMINDER_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROFILE_AI_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROFILE_POST_PUBLISHED';
