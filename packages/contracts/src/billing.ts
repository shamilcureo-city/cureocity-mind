import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 53 — Razorpay billing + trial enforcement.
 *
 * Plans:
 *   FREE_TRIAL    — default; capped at trialSessionCap real-client sessions.
 *   SOLO_MONTHLY  — ₹999/month (env-configurable).
 *   SOLO_ANNUAL   — ₹9,990/year (env-configurable).
 *
 * Razorpay payment posture: one-time Orders per period + paidThroughAt.
 * We deliberately avoid Razorpay Subscriptions / UPI auto-debit for V1
 * — they add a webhook state machine for marginal gain at one SKU.
 * Revisit post-PMF when the renewal-friction signal is real.
 */

export const BillingPlanSchema = z.enum(['FREE_TRIAL', 'SOLO_MONTHLY', 'SOLO_ANNUAL']);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const BillingPaymentStatusSchema = z.enum(['CREATED', 'PAID', 'FAILED']);
export type BillingPaymentStatus = z.infer<typeof BillingPaymentStatusSchema>;

/**
 * Entitlement summary the UI + the session-create gate both read.
 * `isPaidActive` collapses (plan, paidThroughAt + grace) into a single
 * boolean so callers don't have to redo the math.
 */
export const BillingEntitlementSchema = z.object({
  plan: BillingPlanSchema,
  isPaidActive: z.boolean(),
  trialCap: z.number().int().nonnegative(),
  trialUsed: z.number().int().nonnegative(),
  /// Null when the account has never paid; the renewal copy uses this.
  paidThroughAt: IsoDateTimeSchema.nullable(),
});
export type BillingEntitlement = z.infer<typeof BillingEntitlementSchema>;

/**
 * POST /api/v1/billing/checkout — therapist picks a plan and the route
 * mints a Razorpay order so the client can open Razorpay Checkout.
 */
export const CreateCheckoutInputSchema = z.object({
  plan: z.enum(['SOLO_MONTHLY', 'SOLO_ANNUAL']),
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
  trialSessionCap: z.number().int().nonnegative(),
  paidThroughAt: IsoDateTimeSchema.nullable(),
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
