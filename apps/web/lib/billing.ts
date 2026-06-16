import {
  MOCK_RAZORPAY_SIGNATURE,
  MockRazorpayBackend,
  RazorpayHttpBackend,
  type IRazorpayPort,
} from '@cureocity/billing';
import { PLAN_CATALOG } from '@cureocity/contracts';
import type { BillingEntitlement, BillingPlan } from '@cureocity/contracts';
import { prisma } from './prisma';

/**
 * Sprint 53 — Billing glue.
 *
 * Module-cached adapter + entitlement helper. Same pattern as
 * apps/web/lib/welcome-email.ts: pick the backend by env, cache it,
 * keep the safety check for refusing the mock in production.
 *
 * Pricing comes from env so we can A/B test without code changes.
 * Defaults shown below are the "anchor at 1 session's fee" guidance:
 * ₹999 monthly, ₹9,990 annual.
 */

declare global {
  var __cureocityRazorpay: IRazorpayPort | undefined;
}

const PAID_GRACE_DAYS = 3;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Kill-switch for the trial + paid-tier session caps. Defaults to ON.
 * Set `BILLING_ENFORCEMENT=off` on Vercel for testing/staging deploys
 * where you don't want the 402 + upgrade modal to interrupt the flow.
 * Production: leave unset (or set to `on`) so the gate enforces.
 */
export function isBillingEnforced(): boolean {
  return (process.env['BILLING_ENFORCEMENT'] ?? 'on').toLowerCase() !== 'off';
}

export function razorpay(): IRazorpayPort {
  if (globalThis.__cureocityRazorpay) return globalThis.__cureocityRazorpay;
  const backend = process.env['BILLING_BACKEND'] ?? 'mock';
  if (backend === 'razorpay') {
    const keyId = process.env['RAZORPAY_KEY_ID'];
    const keySecret = process.env['RAZORPAY_KEY_SECRET'];
    const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'];
    if (!keyId || !keySecret || !webhookSecret) {
      throw new Error(
        'BILLING_BACKEND=razorpay requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET',
      );
    }
    console.info(`[billing] backend=razorpay keyId=${keyId.slice(0, 10)}…`);
    globalThis.__cureocityRazorpay = new RazorpayHttpBackend({ keyId, keySecret, webhookSecret });
    return globalThis.__cureocityRazorpay;
  }
  // Mock branch — fail-closed in production unless explicitly allowed.
  const isProduction = process.env['VERCEL_ENV'] === 'production';
  const allowMock = process.env['BILLING_ALLOW_MOCK'] === 'true';
  if (isProduction && !allowMock) {
    throw new Error(
      'BILLING_BACKEND=mock refused in production. Set BILLING_BACKEND=razorpay (with creds) or BILLING_ALLOW_MOCK=true.',
    );
  }
  console.info(
    `[billing] backend=mock (signature=${MOCK_RAZORPAY_SIGNATURE}) — set BILLING_BACKEND=razorpay for real charges`,
  );
  globalThis.__cureocityRazorpay = new MockRazorpayBackend();
  return globalThis.__cureocityRazorpay;
}

export function publicRazorpayKeyId(): string | null {
  return process.env['NEXT_PUBLIC_RAZORPAY_KEY_ID'] ?? null;
}

/**
 * List price in rupees for a plan, read from PLAN_CATALOG and
 * overridable per the catalog's envKey (so we can A/B a price without a
 * deploy). Returns 0 for FREE_TRIAL / unpriced — the checkout route
 * treats <= 0 as "not configured" and 500s rather than minting a zero
 * order. A non-numeric env override falls back to the catalog default.
 */
export function planAmountInr(plan: BillingPlan): number {
  const spec = PLAN_CATALOG[plan];
  if (!spec || spec.defaultPriceInr <= 0) return 0;
  const override = spec.envKey ? process.env[spec.envKey] : undefined;
  const parsed = override !== undefined && override !== '' ? Number(override) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : spec.defaultPriceInr;
}

export function planPeriodDays(plan: BillingPlan): number {
  return PLAN_CATALOG[plan]?.periodDays ?? 0;
}

/**
 * Upsert the BillingAccount row for a therapist. Every paid path
 * needs an account row to exist; calling this is idempotent.
 */
export async function ensureBillingAccount(psychologistId: string): Promise<{ id: string }> {
  const existing = await prisma.billingAccount.findUnique({
    where: { psychologistId },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.billingAccount.create({
    data: { psychologistId },
    select: { id: true },
  });
}

/**
 * Compute the entitlement summary the session-create gate + the sidebar
 * widget + the Plan page all read. `trialUsed` deliberately excludes
 * demo "Example" client sessions (Sprint 48 isDemo filter) — demo
 * sessions must never burn trial allowance.
 */
export async function getEntitlement(psychologistId: string): Promise<BillingEntitlement> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const [account, trialUsed, monthlyUsed] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { psychologistId } }),
    prisma.session.count({
      where: { psychologistId, client: { isDemo: false } },
    }),
    // Sprint 56 — rolling-30-day count drives the paid-tier monthly cap.
    prisma.session.count({
      where: { psychologistId, client: { isDemo: false }, createdAt: { gte: since } },
    }),
  ]);
  if (!account) {
    return {
      plan: 'FREE_TRIAL',
      status: 'ACTIVE',
      isPaidActive: false,
      trialCap: 10,
      trialUsed,
      monthlyUsed,
      monthlySessionCap: null,
      paidThroughAt: null,
    };
  }
  const now = Date.now();
  const grace = PAID_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const isPaidActive =
    account.plan !== 'FREE_TRIAL' &&
    account.paidThroughAt !== null &&
    account.paidThroughAt.getTime() + grace > now;
  return {
    plan: account.plan,
    status: account.status,
    isPaidActive,
    trialCap: account.trialSessionCap,
    trialUsed,
    monthlyUsed,
    // Only an active paid tier with a finite cap (Trainee/Starter) gates
    // on the rolling window; Pro/Premium + trial return null here.
    monthlySessionCap: isPaidActive ? PLAN_CATALOG[account.plan].monthlySessionCap : null,
    paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
  };
}

/**
 * Extend paidThroughAt by the plan's period, computed from
 * max(now, current paidThroughAt) so a renewal mid-period adds time
 * rather than resetting.
 */
export function nextPaidThroughAt(plan: BillingPlan, current: Date | null): Date {
  const start = current && current.getTime() > Date.now() ? current : new Date();
  const next = new Date(start);
  next.setDate(next.getDate() + planPeriodDays(plan));
  return next;
}
