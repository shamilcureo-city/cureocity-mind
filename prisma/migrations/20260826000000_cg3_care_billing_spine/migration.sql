-- CG3 — Care billing spine + graceful cap (docs/CARE_GROWTH_SYSTEM.md §7/§12).
-- Idempotent per the per-sprint migration convention (CLAUDE.md §4).

-- Plus is a prepaid 30-day pass; the gate computes the effective tier.
ALTER TABLE "care_users" ADD COLUMN IF NOT EXISTS "planExpiresAt" TIMESTAMP(3);

-- One row per Razorpay order (therapist Sprint-53 pattern, Care twin).
CREATE TABLE IF NOT EXISTS "care_payments" (
    "id" TEXT NOT NULL,
    "careUserId" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "sku" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "rawEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "care_payments_razorpayOrderId_key" ON "care_payments"("razorpayOrderId");
CREATE INDEX IF NOT EXISTS "care_payments_careUserId_createdAt_idx" ON "care_payments"("careUserId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "care_payments" ADD CONSTRAINT "care_payments_careUserId_fkey"
    FOREIGN KEY ("careUserId") REFERENCES "care_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Billing audit actions (literal writers per the chaos-test rule).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_CHECKOUT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_PLAN_UPGRADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_PAYMENT_FAILED';
