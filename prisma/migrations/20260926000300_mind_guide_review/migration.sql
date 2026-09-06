-- UI review metadata is not a clinical intervention or suitability approval.
ALTER TABLE "therapy_scripts" ADD COLUMN IF NOT EXISTS "reviewProgress" JSONB;
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'THERAPY_GUIDE_REVIEW_UPDATED';
