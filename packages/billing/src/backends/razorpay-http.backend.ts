import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreateOrderArgs, CreatedOrder, IRazorpayPort } from '../types';

/**
 * Sprint 53 — Razorpay HTTP backend.
 *
 * Talks to https://api.razorpay.com/v1/orders via fetch and verifies
 * HMAC-SHA256 signatures with node:crypto. No `razorpay` SDK
 * dependency — the surface is small and the SDK is heavy.
 */
export interface RazorpayHttpOptions {
  /** rzp_live_… or rzp_test_… */
  keyId: string;
  keySecret: string;
  /** Webhook secret configured in the Razorpay dashboard. */
  webhookSecret: string;
  /** Override for testing; defaults to the public API host. */
  baseUrl?: string;
  /** Override fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.razorpay.com';

export class RazorpayHttpBackend implements IRazorpayPort {
  private readonly opts: Required<Omit<RazorpayHttpOptions, 'fetchImpl' | 'baseUrl'>> & {
    baseUrl: string;
    fetchImpl: typeof fetch;
  };

  constructor(opts: RazorpayHttpOptions) {
    this.opts = {
      keyId: opts.keyId,
      keySecret: opts.keySecret,
      webhookSecret: opts.webhookSecret,
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  async createOrder(args: CreateOrderArgs): Promise<CreatedOrder> {
    const body = JSON.stringify({
      amount: args.amountPaise,
      currency: 'INR',
      receipt: args.receipt,
      ...(args.notes && { notes: args.notes }),
    });
    const authToken = Buffer.from(`${this.opts.keyId}:${this.opts.keySecret}`).toString('base64');
    const res = await this.opts.fetchImpl(`${this.opts.baseUrl}/v1/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${authToken}`,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Razorpay createOrder failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error('Razorpay createOrder returned no id');
    return { orderId: data.id };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.opts.webhookSecret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac('sha256', this.opts.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return safeEqualHex(expected, signature);
  }
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
