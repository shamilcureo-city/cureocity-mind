-- CreateEnum
CREATE TYPE "ModalityTransitionTrigger" AS ENUM ('PSYCHOLOGIST_MANUAL', 'SYSTEM_SUGGESTION_ACCEPTED', 'SYSTEM_AUTO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_PHASE_TRANSITIONED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'EXERCISE_PRESCRIBED';

-- CreateTable
CREATE TABLE "modality_states" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "modality" "SessionModality" NOT NULL,
    "currentPhase" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modality_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modality_transitions" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "fromPhase" TEXT NOT NULL,
    "toPhase" TEXT NOT NULL,
    "trigger" "ModalityTransitionTrigger" NOT NULL,
    "reason" TEXT NOT NULL,
    "psychologistId" TEXT,
    "evidence" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modality_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modality_states_clientId_key" ON "modality_states"("clientId");

-- CreateIndex
CREATE INDEX "modality_states_psychologistId_modality_idx" ON "modality_states"("psychologistId", "modality");

-- CreateIndex
CREATE INDEX "modality_transitions_stateId_occurredAt_idx" ON "modality_transitions"("stateId", "occurredAt");

-- AddForeignKey
ALTER TABLE "modality_states" ADD CONSTRAINT "modality_states_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modality_states" ADD CONSTRAINT "modality_states_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modality_transitions" ADD CONSTRAINT "modality_transitions_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "modality_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

