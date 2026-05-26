-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CONSENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'AUDIO_CHUNK_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTE_DRAFT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTE_DRAFT_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTE_SIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'COST_CIRCUIT_TRIPPED';
ALTER TYPE "AuditAction" ADD VALUE 'CRISIS_FLAG_RAISED';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "consentSnapshot" JSONB;

