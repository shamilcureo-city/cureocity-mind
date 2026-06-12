import type { CreateOrderArgs, CreatedOrder, IRazorpayPort } from '../types';

/**
 * Sprint 53 — Mock Razorpay backend.
 *
 * Deterministic ids + a single trusted signature value so a CI run
 * can simulate the full create-order → webhook-captured cycle without
 * leaving the test process.
 *
 * Refuse to boot in production unless BILLING_ALLOW_MOCK=true is set
 * (handled by apps/web/lib/billing.ts, not here — this backend is
 * just the mock itself).
 */
const MOCK_SIGNATURE = 'mock-signature';

export class MockRazorpayBackend implements IRazorpayPort {
  private counter = 0;

  async createOrder(args: CreateOrderArgs): Promise<CreatedOrder> {
    this.counter += 1;
    const id = `order_mock_${this.counter}_${args.receipt}`;
    return { orderId: id };
  }

  verifyWebhookSignature(_rawBody: string, signature: string | null): boolean {
    return signature === MOCK_SIGNATURE;
  }

  verifyCheckoutSignature(_orderId: string, _paymentId: string, signature: string): boolean {
    return signature === MOCK_SIGNATURE;
  }
}

export const MOCK_RAZORPAY_SIGNATURE = MOCK_SIGNATURE;
