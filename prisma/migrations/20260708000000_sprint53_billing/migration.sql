-- Sprint 53 — Razorpay billing + trial enforcement.
--
-- Until now, the FREE_PILOT_SESSION_CAP = 10 was a display-only
-- counter in the sidebar and Settings → Plan with no enforcement and
-- a "paid plans are coming" note. This sprint:
--   * Lifts the cap into a real BillingAccount row (per psychologist).
--   * Wires a soft enforcement gate at session creation that returns
--     402 with a TRIAL_CAP_REACHED code once trialUsed >= trialSessionCap.
--   * Persists Razorpay orders + webhook outcomes in BillingPayment.
--   * Adds audit actions for the lifecycle (trial cap reached, plan
--     upgraded, payment received, payment failed).
--
-- The trial counter excludes demo "Example" client sessions (Sprint 48
-- isDemo filter); that's the only call-site exemption.
--
-- We pick Razorpay Orders + Checkout per period instead of Razorpay
-- Subscriptions. Subscriptions add a webhook state machine (auth →
-- captured → halted) for an India-only product with one SKU; an order
-- per period + paidThroughAt + a renewal-reminder email is simpler
-- and trivially mockable for dev/CI.

-- 1. Enums.
DO $$ BEGIN
  CREATE TYPE "BillingPlan" AS ENUM ('FREE_TRIAL', 'SOLO_MONTHLY', 'SOLO_ANNUAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingPaymentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRIAL_CAP_REACHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_UPGRADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';

-- 2. Tables.
CREATE TABLE IF NOT EXISTS "billing_accounts" (
  "id"               TEXT NOT NULL,
  "psychologistId"   TEXT NOT NULL,
  "plan"             "BillingPlan" NOT NULL DEFAULT 'FREE_TRIAL',
  "trialSessionCap"  INTEGER NOT NULL DEFAULT 10,
  "paidThroughAt"    TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_accounts_psychologistId_key"
  ON "billing_accounts" ("psychologistId");
CREATE INDEX IF NOT EXISTS "billing_accounts_psychologistId_idx"
  ON "billing_accounts" ("psychologistId");

CREATE TABLE IF NOT EXISTS "billing_payments" (
  "id"                 TEXT NOT NULL,
  "psychologistId"     TEXT NOT NULL,
  "billingAccountId"   TEXT NOT NULL,
  "razorpayOrderId"    TEXT NOT NULL,
  "razorpayPaymentId"  TEXT,
  "plan"               "BillingPlan" NOT NULL,
  "amountInr"          INTEGER NOT NULL,
  "status"             "BillingPaymentStatus" NOT NULL DEFAULT 'CREATED',
  "periodStart"        TIMESTAMP(3),
  "periodEnd"          TIMESTAMP(3),
  "rawEvent"           JSONB,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_payments_billingAccountId_fkey" FOREIGN KEY ("billingAccountId")
    REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_razorpayOrderId_key"
  ON "billing_payments" ("razorpayOrderId");
CREATE INDEX IF NOT EXISTS "billing_payments_psychologistId_createdAt_idx"
  ON "billing_payments" ("psychologistId", "createdAt");
