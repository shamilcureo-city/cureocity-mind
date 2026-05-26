-- CreateEnum
CREATE TYPE "ExerciseAssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'EXERCISE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'EXERCISE_COMPLETION_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'EXERCISE_SKIPPED';
ALTER TYPE "AuditAction" ADD VALUE 'MOOD_LOGGED';
ALTER TYPE "AuditAction" ADD VALUE 'JOURNAL_ENTRY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOURNAL_ENTRY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CLIENT_FIREBASE_LINKED';
ALTER TYPE "AuditAction" ADD VALUE 'AUDIO_RETENTION_PURGED';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "clientFirebaseUid" TEXT;

-- CreateTable
CREATE TABLE "exercise_assignments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "status" "ExerciseAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "response" JSONB,
    "therapistNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mood_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mood_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mood" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercise_assignments_clientId_status_idx" ON "exercise_assignments"("clientId", "status");

-- CreateIndex
CREATE INDEX "exercise_assignments_psychologistId_assignedAt_idx" ON "exercise_assignments"("psychologistId", "assignedAt");

-- CreateIndex
CREATE INDEX "exercise_assignments_clientId_exerciseId_assignedAt_idx" ON "exercise_assignments"("clientId", "exerciseId", "assignedAt");

-- CreateIndex
CREATE INDEX "mood_logs_clientId_recordedAt_idx" ON "mood_logs"("clientId", "recordedAt");

-- CreateIndex
CREATE INDEX "journal_entries_clientId_recordedAt_idx" ON "journal_entries"("clientId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "clients_clientFirebaseUid_key" ON "clients"("clientFirebaseUid");

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mood_logs" ADD CONSTRAINT "mood_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

