import { NextResponse, type NextRequest } from 'next/server';
import { CreateCheckoutInputSchema, type CreateCheckoutResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import {
  checkoutUnavailableReason,
  ensureBillingAccount,
  planAmountInr,
  publicRazorpayKeyId,
  razorpay,
} from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/billing/checkout — Sprint 53.
 *
 * Mint a Razorpay order for the picked plan, persist a CREATED
 * BillingPayment row, and return the order id + amount + public
 * key for Razorpay Checkout. The client opens checkout.razorpay.com
 * with `{ order_id }`; the canonical source of truth for "did the
 * payment succeed" is the webhook, not the checkout success handler.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const body = await parseJson(req, CreateCheckoutInputSchema);
  if (!body.ok) return body.response;

  // Fail OPEN to a human path: when online payment can't run (Razorpay not
  // yet configured on this deployment), tell the UI so it renders the
  // contact-us fallback instead of a dead 500 under the Choose button.
  const unavailable = checkoutUnavailableReason();
  if (unavailable) {
    console.warn(`[billing] checkout unavailable: ${unavailable}`);
    return NextResponse.json(
      {
        error:
          'Online payment isn’t live yet. Message us and we’ll activate your plan the same day.',
        code: 'CHECKOUT_UNAVAILABLE',
      },
      { status: 503 },
    );
  }

  const amountInr = planAmountInr(body.value.plan);
  if (amountInr <= 0) {
    return NextResponse.json({ error: 'Plan amount not configured' }, { status: 500 });
  }
  const keyId = publicRazorpayKeyId();
  if (!keyId) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_RAZORPAY_KEY_ID is not set; checkout cannot launch.' },
      { status: 500 },
    );
  }

  const account = await ensureBillingAccount(auth.value.psychologistId);

  const receipt = `psy_${auth.value.psychologistId.slice(0, 8)}_${Date.now()}`;
  const order = await razorpay().createOrder({
    amountPaise: amountInr * 100,
    receipt,
    notes: {
      psychologistId: auth.value.psychologistId,
      plan: body.value.plan,
    },
  });

  await prisma.billingPayment.create({
    data: {
      psychologistId: auth.value.psychologistId,
      billingAccountId: account.id,
      razorpayOrderId: order.orderId,
      plan: body.value.plan,
      amountInr,
      status: 'CREATED',
    },
  });

  const response: CreateCheckoutResponse = {
    orderId: order.orderId,
    amountInr,
    keyId,
  };
  return NextResponse.json(response);
}
