-- Sprint DV6 — doctor differential diagnosis (reasoning copilot).
-- New `differentials` table (one row per session, reuses NoteDraftStatus),
-- a PASS_9_DIFFERENTIAL GeminiPass enum value, and a DIFFERENTIAL_GENERATED
-- audit action. Append-only enum values (idempotent), per the per-sprint
-- migration convention. See docs/DOCTOR_VERTICAL.md §6, §7.

-- CreateTable
CREATE TABLE IF NOT EXISTS "differentials" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "status" "NoteDraftStatus" NOT NULL DEFAULT 'PENDING',
  "body" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "differentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "differentials_sessionId_key" ON "differentials"("sessionId");
CREATE INDEX IF NOT EXISTS "differentials_psychologistId_idx" ON "differentials"("psychologistId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "differentials" ADD CONSTRAINT "differentials_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum — new Gemini pass (append-only, idempotent).
ALTER TYPE "GeminiPass" ADD VALUE IF NOT EXISTS 'PASS_9_DIFFERENTIAL';

-- AlterEnum — differential audit action (append-only, idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DIFFERENTIAL_GENERATED';
