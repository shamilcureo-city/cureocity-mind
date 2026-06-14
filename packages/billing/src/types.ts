/**
 * Sprint 53 — Razorpay adapter port.
 *
 * Two implementations land in this package:
 *   RazorpayHttpBackend  — talks to https://api.razorpay.com via fetch,
 *                          HMAC-SHA256 signatures via node:crypto.
 *                          No SDK dependency.
 *   MockRazorpayBackend  — deterministic ids, accepts only the
 *                          literal signature 'mock-signature' so a
 *                          CI run can replay a webhook locally.
 *
 * Selected at module load by BILLING_BACKEND=mock|razorpay in
 * apps/web/lib/billing.ts. The mock backend must refuse to boot when
 * VERCEL_ENV === 'production' unless BILLING_ALLOW_MOCK=true is also
 * set (auth-bypass fail-closed posture).
 */

export interface CreateOrderArgs {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}

export interface CreatedOrder {
  orderId: string;
}

export interface IRazorpayPort {
  /** Create a Razorpay order; returns the order id. */
  createOrder(args: CreateOrderArgs): Promise<CreatedOrder>;

  /**
   * Verify a webhook payload's signature.
   * `rawBody` MUST be the raw bytes from the request — JSON.parse-ing
   * first breaks the HMAC. Caller is responsible for reading
   * `req.text()` before any other body consumer.
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;

  /**
   * Verify a Razorpay Checkout success handler signature client-side.
   * Order + payment id + the secret produce the HMAC; the client
   * relays the signature. We use this as a soft check; the
   * canonical truth is the webhook.
   */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
}
