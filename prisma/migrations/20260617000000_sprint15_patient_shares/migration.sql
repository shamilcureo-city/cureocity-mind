-- Sprint 15 — Patient CRM & sharing.
--
-- Adds the PatientShare table — one row per (artefact, channel)
-- Send-to-patient action. The snapshot column locks the artefact
-- body at share time so the patient always sees what was sent,
-- even if the source row is later edited or deleted. The shareToken
-- opens a public read-only portal at /p/<token>.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "PatientShareArtefactType" AS ENUM (
    'SIGNED_NOTE',
    'REFLECTION_QUESTIONS',
    'THERAPY_SCRIPT',
    'TREATMENT_PLAN'
);

CREATE TYPE "PatientShareChannel" AS ENUM (
    'WHATSAPP',
    'EMAIL',
    'PORTAL_LINK'
);

CREATE TYPE "PatientShareStatus" AS ENUM (
    'PENDING',
    'SENT',
    'OPENED',
    'TRANSIENT_FAILURE',
    'PERMANENT_FAILURE'
);

-- ---------------------------------------------------------------------------
-- AuditAction enum — two new values for Sprint 15
-- ---------------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_ARTEFACT_SHARED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_PORTAL_OPENED';

-- ---------------------------------------------------------------------------
-- PatientShare
-- ---------------------------------------------------------------------------

CREATE TABLE "patient_shares" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "sessionId" TEXT,
    "artefactType" "PatientShareArtefactType" NOT NULL,
    "artefactId" TEXT NOT NULL,
    "channel" "PatientShareChannel" NOT NULL,
    "status" "PatientShareStatus" NOT NULL DEFAULT 'PENDING',
    "shareToken" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "snapshot" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "toContact" TEXT,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_shares_shareToken_key"
    ON "patient_shares"("shareToken");
CREATE INDEX "patient_shares_clientId_createdAt_idx"
    ON "patient_shares"("clientId", "createdAt");
CREATE INDEX "patient_shares_psychologistId_createdAt_idx"
    ON "patient_shares"("psychologistId", "createdAt");
CREATE INDEX "patient_shares_status_createdAt_idx"
    ON "patient_shares"("status", "createdAt");
CREATE INDEX "patient_shares_sessionId_idx"
    ON "patient_shares"("sessionId");

ALTER TABLE "patient_shares"
    ADD CONSTRAINT "patient_shares_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_shares"
    ADD CONSTRAINT "patient_shares_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_shares"
    ADD CONSTRAINT "patient_shares_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
