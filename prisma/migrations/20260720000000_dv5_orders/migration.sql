-- Sprint DV5 — doctor Rx + clinical orders.
-- New OrderStatus enum + two tables keyed by sessionId, tenant-filtered
-- by psychologistId. Append-only audit-enum values (idempotent). See
-- docs/DOCTOR_VERTICAL.md §6 + docs/DOCTOR_VERTICAL_SPRINTS.md DV5.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "medication_orders" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "medication_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "clinical_orders" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "psychologistId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "clinical_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "medication_orders_sessionId_status_idx" ON "medication_orders"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "medication_orders_psychologistId_idx" ON "medication_orders"("psychologistId");
CREATE INDEX IF NOT EXISTS "clinical_orders_sessionId_status_idx" ON "clinical_orders"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "clinical_orders_psychologistId_idx" ON "clinical_orders"("psychologistId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum — Rx + clinical-order audit lifecycle (append-only, idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDICATION_ORDER_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDICATION_ORDER_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDICATION_ORDER_DISCARDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_ORDER_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_ORDER_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLINICAL_ORDER_DISCARDED';
