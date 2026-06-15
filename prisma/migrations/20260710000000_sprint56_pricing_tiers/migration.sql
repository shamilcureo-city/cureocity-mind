-- Sprint 56 — multi-tier pricing ladder.
--
-- Append-only enum additions. `ADD VALUE IF NOT EXISTS` keeps re-runs
-- idempotent. No table changes: per-plan facts (price, period, monthly
-- session cap, label) live in PLAN_CATALOG in
-- packages/contracts/src/billing.ts, not the DB. Legacy SOLO_* values
-- stay so grandfathered payers keep renewing.

ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'TRAINEE_MONTHLY';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'STARTER_MONTHLY';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'STARTER_ANNUAL';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PRO_MONTHLY';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PRO_QUARTERLY';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PRO_ANNUAL';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PREMIUM_MONTHLY';
ALTER TYPE "BillingPlan" ADD VALUE IF NOT EXISTS 'PREMIUM_ANNUAL';

-- Audit verb for the paid-tier rolling-30-day session cap (Trainee/Starter).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_CAP_REACHED';
