import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 53 — Razorpay billing + trial enforcement.
 * Sprint 56 — multi-tier pricing ladder.
 *
 * Razorpay payment posture: one-time Orders per period + paidThroughAt.
 * We deliberately avoid Razorpay Subscriptions / UPI auto-debit for V1.
 *
 * The plan enum stays FLAT (each value = a tier+interval pair) because
 * the whole order/webhook/entitlement path keys off a single
 * `BillingPlan`. Everything derivable about a plan — price, period,
 * monthly session cap, label, whether new buyers can pick it — lives in
 * the one `PLAN_CATALOG` below so the Plan page, the checkout route, the
 * session gate, and the sidebar can't drift on per-plan facts.
 *
 * Legacy `SOLO_*` (Sprint 53, ₹999 / ₹9,990) remain valid + priced so
 * existing payers are grandfathered, but `purchasable: false` keeps them
 * off the Plan page for new buyers.
 */
export const BillingPlanSchema = z.enum([
  'FREE_TRIAL',
  // Legacy — grandfathered (Sprint 53). Not offered to new buyers.
  'SOLO_MONTHLY',
  'SOLO_ANNUAL',
  // Sprint 56 — tier ladder.
  'TRAINEE_MONTHLY',
  'STARTER_MONTHLY',
  'STARTER_ANNUAL',
  'PRO_MONTHLY',
  'PRO_QUARTERLY',
  'PRO_ANNUAL',
  'PREMIUM_MONTHLY',
  'PREMIUM_ANNUAL',
]);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const BillingTierSchema = z.enum(['FREE', 'TRAINEE', 'STARTER', 'PRO', 'PREMIUM', 'SOLO']);
export type BillingTier = z.infer<typeof BillingTierSchema>;

export const BillingIntervalSchema = z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

/** One row of the plan catalog — everything derivable about a plan. */
export interface PlanSpec {
  tier: BillingTier;
  interval: BillingInterval;
  /** Human label e.g. "Pro · monthly" (used in history + receipts). */
  label: string;
  /** List price in rupees; `apps/web/lib/billing.ts` applies env overrides. */
  defaultPriceInr: number;
  /** Days added to paidThroughAt on payment. */
  periodDays: number;
  /** Real-client sessions allowed per rolling 30 days; null = unlimited. */
  monthlySessionCap: number | null;
  /** Whether a new buyer can select this plan on the Plan page. */
  purchasable: boolean;
  /** Env var that overrides defaultPriceInr ('' = not priced). */
  envKey: string;
  /** Anchor tier — visually highlighted on the Plan page. */
  highlight: boolean;
}

export const PLAN_CATALOG: Record<BillingPlan, PlanSpec> = {
  FREE_TRIAL: {
    tier: 'FREE',
    interval: 'MONTHLY',
    label: 'Free trial',
    defaultPriceInr: 0,
    periodDays: 0,
    monthlySessionCap: null,
    purchasable: false,
    envKey: '',
    highlight: false,
  },
  TRAINEE_MONTHLY: {
    tier: 'TRAINEE',
    interval: 'MONTHLY',
    label: 'Trainee · monthly',
    defaultPriceInr: 499,
    periodDays: 31,
    monthlySessionCap: 15,
    purchasable: true,
    envKey: 'BILLING_PRICE_TRAINEE_MONTHLY_INR',
    highlight: false,
  },
  STARTER_MONTHLY: {
    tier: 'STARTER',
    interval: 'MONTHLY',
    label: 'Starter · monthly',
    defaultPriceInr: 1499,
    periodDays: 31,
    monthlySessionCap: 30,
    purchasable: true,
    envKey: 'BILLING_PRICE_STARTER_MONTHLY_INR',
    highlight: false,
  },
  STARTER_ANNUAL: {
    tier: 'STARTER',
    interval: 'ANNUAL',
    label: 'Starter · annual',
    defaultPriceInr: 14990,
    periodDays: 366,
    monthlySessionCap: 30,
    purchasable: true,
    envKey: 'BILLING_PRICE_STARTER_ANNUAL_INR',
    highlight: false,
  },
  PRO_MONTHLY: {
    tier: 'PRO',
    interval: 'MONTHLY',
    label: 'Pro · monthly',
    defaultPriceInr: 3499,
    periodDays: 31,
    monthlySessionCap: null,
    purchasable: true,
    envKey: 'BILLING_PRICE_PRO_MONTHLY_INR',
    highlight: true,
  },
  PRO_QUARTERLY: {
    tier: 'PRO',
    interval: 'QUARTERLY',
    label: 'Pro · quarterly',
    defaultPriceInr: 9450,
    periodDays: 92,
    monthlySessionCap: null,
    purchasable: true,
    envKey: 'BILLING_PRICE_PRO_QUARTERLY_INR',
    highlight: false,
  },
  PRO_ANNUAL: {
    tier: 'PRO',
    interval: 'ANNUAL',
    label: 'Pro · annual',
    defaultPriceInr: 34990,
    periodDays: 366,
    monthlySessionCap: null,
    purchasable: true,
    envKey: 'BILLING_PRICE_PRO_ANNUAL_INR',
    highlight: false,
  },
  PREMIUM_MONTHLY: {
    tier: 'PREMIUM',
    interval: 'MONTHLY',
    label: 'Premium · monthly',
    defaultPriceInr: 6999,
    periodDays: 31,
    monthlySessionCap: null,
    purchasable: true,
    envKey: 'BILLING_PRICE_PREMIUM_MONTHLY_INR',
    highlight: false,
  },
  PREMIUM_ANNUAL: {
    tier: 'PREMIUM',
    interval: 'ANNUAL',
    label: 'Premium · annual',
    defaultPriceInr: 69990,
    periodDays: 366,
    monthlySessionCap: null,
    purchasable: true,
    envKey: 'BILLING_PRICE_PREMIUM_ANNUAL_INR',
    highlight: false,
  },
  // Legacy — grandfathered, still priced for renewals, hidden from new buyers.
  SOLO_MONTHLY: {
    tier: 'SOLO',
    interval: 'MONTHLY',
    label: 'Solo · monthly',
    defaultPriceInr: 999,
    periodDays: 31,
    monthlySessionCap: null,
    purchasable: false,
    envKey: 'BILLING_PRICE_SOLO_MONTHLY_INR',
    highlight: false,
  },
  SOLO_ANNUAL: {
    tier: 'SOLO',
    interval: 'ANNUAL',
    label: 'Solo · annual',
    defaultPriceInr: 9990,
    periodDays: 366,
    monthlySessionCap: null,
    purchasable: false,
    envKey: 'BILLING_PRICE_SOLO_ANNUAL_INR',
    highlight: false,
  },
};

/** Marketing copy per tier — kept out of PlanSpec since it's presentational. */
export const TIER_COPY: Record<BillingTier, { tierLabel: string; blurb: string; features: string[] }> = {
  FREE: { tierLabel: 'Free trial', blurb: 'Try the full product on real sessions.', features: [] },
  TRAINEE: {
    tierLabel: 'Trainee',
    blurb: 'For students & supervisees building a first caseload.',
    features: [
      'Up to 15 sessions / month',
      'AI note-writing (SOAP + intake)',
      'Patient portal + progress reports',
    ],
  },
  STARTER: {
    tierLabel: 'Starter',
    blurb: 'For early independent practice.',
    features: [
      'Up to 30 sessions / month',
      'Full AI Copilot (Brief, Journey, Script)',
      'Patient portal + WhatsApp / email shares',
    ],
  },
  PRO: {
    tierLabel: 'Pro',
    blurb: 'For a busy full-time practice.',
    features: [
      'Unlimited sessions',
      'All AI passes incl. Case Consult & Concept Map',
      'Priority processing',
      'Patient portal + shares',
    ],
  },
  PREMIUM: {
    tierLabel: 'Premium',
    blurb: 'For high-volume practices that want cost control.',
    features: [
      'Everything in Pro',
      'Bring your own Gemini key',
      'Data export (CSV)',
      'White-glove migration',
    ],
  },
  SOLO: {
    tierLabel: 'Solo',
    blurb: 'Legacy plan.',
    features: ['Unlimited sessions', 'Full AI Copilot'],
  },
};

/** Tiers shown on the Plan page, in ladder order. */
export const TIER_ORDER: BillingTier[] = ['TRAINEE', 'STARTER', 'PRO', 'PREMIUM'];

/** Plans a new buyer can purchase today (excludes FREE_TRIAL + legacy SOLO). */
export const PURCHASABLE_PLANS: PurchasablePlan[] = (
  Object.keys(PLAN_CATALOG) as BillingPlan[]
).filter((p) => PLAN_CATALOG[p].purchasable) as PurchasablePlan[];

export function isPaidPlan(plan: BillingPlan): boolean {
  return plan !== 'FREE_TRIAL';
}
export function planLabel(plan: BillingPlan): string {
  return PLAN_CATALOG[plan].label;
}
export function planTierLabel(plan: BillingPlan): string {
  return TIER_COPY[PLAN_CATALOG[plan].tier].tierLabel;
}
/** Months in a billing interval — used to compute effective monthly price. */
export function intervalMonths(interval: BillingInterval): number {
  return interval === 'ANNUAL' ? 12 : interval === 'QUARTERLY' ? 3 : 1;
}

/** Ladder grouped by tier for the Plan page (monthly plan first within a tier). */
export function purchasablePlansByTier(): Array<{
  tier: BillingTier;
  tierLabel: string;
  blurb: string;
  features: string[];
  plans: PurchasablePlan[];
}> {
  return TIER_ORDER.map((tier) => {
    const plans = PURCHASABLE_PLANS.filter((p) => PLAN_CATALOG[p].tier === tier).sort(
      (a, b) => PLAN_CATALOG[a].periodDays - PLAN_CATALOG[b].periodDays,
    );
    return { tier, ...TIER_COPY[tier], plans };
  }).filter((g) => g.plans.length > 0);
}

export const BillingPaymentStatusSchema = z.enum(['CREATED', 'PAID', 'FAILED']);
export type BillingPaymentStatus = z.infer<typeof BillingPaymentStatusSchema>;

/** Sprint 56 (Lever 4 #4) — self-serve plan lifecycle state. */
export const BillingAccountStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']);
export type BillingAccountStatus = z.infer<typeof BillingAccountStatusSchema>;

/**
 * Entitlement summary the UI + the session-create gate both read.
 * `isPaidActive` collapses (plan, paidThroughAt + grace) into a single
 * boolean so callers don't have to redo the math.
 */
export const BillingEntitlementSchema = z.object({
  plan: BillingPlanSchema,
  /// Sprint 56 — lifecycle state (ACTIVE / PAUSED / CANCELLED).
  status: BillingAccountStatusSchema,
  isPaidActive: z.boolean(),
  trialCap: z.number().int().nonnegative(),
  trialUsed: z.number().int().nonnegative(),
  /// Sprint 56 — rolling-30-day real-client session count + the active
  /// paid tier's monthly cap (null = unlimited / not on a capped tier).
  monthlyUsed: z.number().int().nonnegative(),
  monthlySessionCap: z.number().int().positive().nullable(),
  /// Null when the account has never paid; the renewal copy uses this.
  paidThroughAt: IsoDateTimeSchema.nullable(),
});
export type BillingEntitlement = z.infer<typeof BillingEntitlementSchema>;

/** Plans accepted by POST /billing/checkout (purchasable set only). */
export const PurchasablePlanSchema = z.enum([
  'TRAINEE_MONTHLY',
  'STARTER_MONTHLY',
  'STARTER_ANNUAL',
  'PRO_MONTHLY',
  'PRO_QUARTERLY',
  'PRO_ANNUAL',
  'PREMIUM_MONTHLY',
  'PREMIUM_ANNUAL',
]);
export type PurchasablePlan = z.infer<typeof PurchasablePlanSchema>;

/**
 * POST /api/v1/billing/checkout — therapist picks a plan and the route
 * mints a Razorpay order so the client can open Razorpay Checkout.
 */
export const CreateCheckoutInputSchema = z.object({
  plan: PurchasablePlanSchema,
});
export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInputSchema>;

export const CreateCheckoutResponseSchema = z.object({
  orderId: z.string().min(1),
  amountInr: z.number().int().positive(),
  /// Razorpay public key id — safe to expose; used by checkout.js.
  keyId: z.string().min(1),
});
export type CreateCheckoutResponse = z.infer<typeof CreateCheckoutResponseSchema>;

/**
 * Server-side row DTOs for the billing tables. Returned by
 * GET /api/v1/billing/me so the Plan page can render history.
 */
export const BillingPaymentSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  billingAccountId: CuidSchema,
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string().nullable(),
  plan: BillingPlanSchema,
  amountInr: z.number().int().positive(),
  status: BillingPaymentStatusSchema,
  periodStart: IsoDateTimeSchema.nullable(),
  periodEnd: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BillingPayment = z.infer<typeof BillingPaymentSchema>;

export const BillingAccountSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  plan: BillingPlanSchema,
  status: BillingAccountStatusSchema,
  trialSessionCap: z.number().int().nonnegative(),
  paidThroughAt: IsoDateTimeSchema.nullable(),
  /// Banked days while PAUSED; null otherwise.
  pausedRemainingDays: z.number().int().nonnegative().nullable(),
  canceledAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BillingAccount = z.infer<typeof BillingAccountSchema>;

export const BillingMeResponseSchema = z.object({
  account: BillingAccountSchema,
  entitlement: BillingEntitlementSchema,
  recentPayments: z.array(BillingPaymentSchema).max(20),
});
export type BillingMeResponse = z.infer<typeof BillingMeResponseSchema>;

/**
 * Razorpay webhook event envelope. We only need to know the event
 * name + the payment + order ids; everything else stays in the rawEvent
 * column for audit/debug.
 */
export const RazorpayWebhookEventSchema = z.object({
  event: z.string().min(1),
  payload: z
    .object({
      payment: z
        .object({
          entity: z
            .object({
              id: z.string().min(1).optional(),
              order_id: z.string().min(1).optional(),
              status: z.string().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
      order: z
        .object({
          entity: z
            .object({
              id: z.string().min(1).optional(),
              amount: z.number().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});
export type RazorpayWebhookEvent = z.infer<typeof RazorpayWebhookEventSchema>;
