-- CreateEnum
CREATE TYPE "EmdrTargetStatus" AS ENUM ('identified', 'assessed', 'in_desensitization', 'desensitized', 'installed', 'body_scan_clear', 'closed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'EMDR_PREPARATION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'EMDR_TARGET_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'EMDR_TARGET_UPDATED';

-- CreateTable
CREATE TABLE "emdr_targets" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "negativeCognition" TEXT NOT NULL,
    "positiveCognition" TEXT NOT NULL,
    "vocStart" INTEGER NOT NULL,
    "vocCurrent" INTEGER,
    "sudsStart" INTEGER NOT NULL,
    "sudsCurrent" INTEGER,
    "emotion" TEXT NOT NULL,
    "bodyLocation" TEXT NOT NULL,
    "status" "EmdrTargetStatus" NOT NULL DEFAULT 'identified',
    "bilateralSetsTotal" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emdr_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emdr_targets_stateId_status_idx" ON "emdr_targets"("stateId", "status");

-- AddForeignKey
ALTER TABLE "emdr_targets" ADD CONSTRAINT "emdr_targets_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "modality_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

