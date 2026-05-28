-- CreateEnum
CREATE TYPE "PsychologistStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISCHARGED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING', 'DATA_RETENTION_EXTENDED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsentCaptureChannel" AS ENUM ('IN_PERSON', 'REMOTE_LINK', 'EMAIL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "SessionModality" AS ENUM ('CBT', 'EMDR', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PSYCHOLOGIST_REGISTERED', 'PSYCHOLOGIST_UPDATED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_VIEWED', 'CLIENT_BRIEFING_VIEWED', 'CLIENT_SOFT_DELETED', 'CONSENT_GRANTED', 'CONSENT_WITHDRAWN', 'CONSENT_EXPIRED', 'SESSION_CREATED', 'SESSION_STARTED', 'SESSION_ENDED', 'SESSION_CANCELLED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('PSYCHOLOGIST', 'SYSTEM', 'CLIENT');

-- CreateTable
CREATE TABLE "psychologists" (
    "id" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "rciNumber" TEXT NOT NULL,
    "rciVerifiedAt" TIMESTAMP(3),
    "status" "PsychologistStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "psychologists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "dateOfBirth" DATE,
    "presentingConcerns" TEXT,
    "preferredModality" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "scriptVersion" TEXT NOT NULL,
    "capturedVia" "ConsentCaptureChannel" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "modality" "SessionModality" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "phaseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorPsychologistId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "psychologists_firebaseUid_key" ON "psychologists"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "psychologists_email_key" ON "psychologists"("email");

-- CreateIndex
CREATE UNIQUE INDEX "psychologists_phone_key" ON "psychologists"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "psychologists_rciNumber_key" ON "psychologists"("rciNumber");

-- CreateIndex
CREATE INDEX "psychologists_status_idx" ON "psychologists"("status");

-- CreateIndex
CREATE INDEX "clients_psychologistId_status_idx" ON "clients"("psychologistId", "status");

-- CreateIndex
CREATE INDEX "clients_psychologistId_deletedAt_idx" ON "clients"("psychologistId", "deletedAt");

-- CreateIndex
CREATE INDEX "consents_clientId_scope_status_idx" ON "consents"("clientId", "scope", "status");

-- CreateIndex
CREATE INDEX "consents_psychologistId_createdAt_idx" ON "consents"("psychologistId", "createdAt");

-- CreateIndex
CREATE INDEX "sessions_clientId_status_idx" ON "sessions"("clientId", "status");

-- CreateIndex
CREATE INDEX "sessions_psychologistId_scheduledAt_idx" ON "sessions"("psychologistId", "scheduledAt");

-- CreateIndex
CREATE INDEX "sessions_psychologistId_status_scheduledAt_idx" ON "sessions"("psychologistId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_createdAt_idx" ON "audit_logs"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorPsychologistId_createdAt_idx" ON "audit_logs"("actorPsychologistId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorPsychologistId_fkey" FOREIGN KEY ("actorPsychologistId") REFERENCES "psychologists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

