import { describe, expect, it } from 'vitest';
import { MOCK_RAZORPAY_SIGNATURE, MockRazorpayBackend } from './mock-razorpay.backend';
import { RazorpayHttpBackend } from './razorpay-http.backend';

describe('MockRazorpayBackend', () => {
  it('creates deterministic order ids and accepts the canonical signature', async () => {
    const b = new MockRazorpayBackend();
    const a = await b.createOrder({ amountPaise: 99900, receipt: 'r1' });
    const c = await b.createOrder({ amountPaise: 99900, receipt: 'r1' });
    expect(a.orderId).toMatch(/^order_mock_/);
    expect(c.orderId).not.toBe(a.orderId);
    expect(b.verifyWebhookSignature('{}', MOCK_RAZORPAY_SIGNATURE)).toBe(true);
    expect(b.verifyWebhookSignature('{}', 'whatever')).toBe(false);
    expect(b.verifyWebhookSignature('{}', null)).toBe(false);
    expect(b.verifyCheckoutSignature('order_mock_1_r1', 'pay_x', MOCK_RAZORPAY_SIGNATURE)).toBe(
      true,
    );
  });
});

describe('RazorpayHttpBackend signatures', () => {
  // The HMAC-SHA256 of 'test-body' with secret 'secret' is precomputed
  // so we can verify the verifier round-trips. Computed via openssl:
  //   echo -n 'test-body' | openssl dgst -sha256 -hmac 'secret'
  const RAW_BODY = 'test-body';
  const SECRET = 'secret';
  const EXPECTED_HEX = 'cd165584491f0734ce620343b5022ffe092f535a2468bb2d283e32ebbe0cd7eb';

  it('accepts a valid webhook signature and rejects a tampered one', () => {
    const b = new RazorpayHttpBackend({
      keyId: 'rzp_test_x',
      keySecret: 'k',
      webhookSecret: SECRET,
    });
    expect(b.verifyWebhookSignature(RAW_BODY, EXPECTED_HEX)).toBe(true);
    expect(b.verifyWebhookSignature(RAW_BODY, EXPECTED_HEX.replace(/.$/, '0'))).toBe(false);
    expect(b.verifyWebhookSignature(RAW_BODY, null)).toBe(false);
  });

  it('verifies the checkout-success signature against orderId|paymentId', () => {
    const b = new RazorpayHttpBackend({
      keyId: 'rzp_test_x',
      keySecret: SECRET,
      webhookSecret: 'unused',
    });
    // HMAC-SHA256 of 'order_abc|pay_xyz' with secret 'secret':
    //   echo -n 'order_abc|pay_xyz' | openssl dgst -sha256 -hmac 'secret'
    const EXPECTED = '6c4490ce5c4839b0437f2b5dccb1fc7301518f94c6d1165b96d0903bfd33b2ae';
    expect(b.verifyCheckoutSignature('order_abc', 'pay_xyz', EXPECTED)).toBe(true);
    expect(b.verifyCheckoutSignature('order_abc', 'pay_xyz', 'wrong')).toBe(false);
  });
});
