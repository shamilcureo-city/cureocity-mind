import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { RazorpayWebhookEventSchema, type BillingPlan } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { nextPaidThroughAt, razorpay } from '@/lib/billing';
import { grantReferrerRewardOnConversion } from '@/lib/referral';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/billing/razorpay/webhook — Sprint 53.
 *
 * PUBLIC, signature-authed (no requirePsychologistId). The Razorpay
 * webhook signature IS the validation — same trust posture as the
 * /p/<token> portal routes.
 *
 * Critical: we MUST read the raw body BEFORE any JSON parsing because
 * the HMAC is over the raw bytes. parseJson would consume the body
 * stream and break the signature check. We Zod-parse AFTER verifying
 * the signature.
 *
 * Idempotent: handlers guard by razorpayOrderId + status so a re-
 * delivered event is a no-op. Razorpay retries on non-2xx, so we
 * always return 200 fast — failures are logged with no rollback.
 *
 * Handled events:
 *   payment.captured / order.paid  → mark PAID, extend paidThroughAt,
 *                                    flip plan, audit PAYMENT_RECEIVED
 *                                    + PLAN_UPGRADED, send invoice email.
 *   payment.failed                 → mark FAILED, audit PAYMENT_FAILED.
 *   anything else                  → 200, no-op (logged).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature');
  if (!razorpay().verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ReturnType<typeof RazorpayWebhookEventSchema.parse>;
  try {
    event = RazorpayWebhookEventSchema.parse(JSON.parse(raw));
  } catch (e) {
    console.error(`[razorpay-webhook] invalid event payload: ${(e as Error).message}`);
    return NextResponse.json({ ok: true });
  }

  const meta = auditMetadataFromRequest(req);
  const orderId =
    event.payload?.payment?.entity?.order_id ?? event.payload?.order?.entity?.id ?? null;

  try {
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      if (!orderId) {
        console.error(`[razorpay-webhook] ${event.event} carried no order id`);
        return NextResponse.json({ ok: true });
      }
      await handleCaptured(orderId, event, meta);
    } else if (event.event === 'payment.failed') {
      if (!orderId) {
        console.error(`[razorpay-webhook] payment.failed carried no order id`);
        return NextResponse.json({ ok: true });
      }
      await handleFailed(orderId, event, meta);
    } else {
      console.info(`[razorpay-webhook] unhandled event ${event.event} (no-op)`);
    }
  } catch (e) {
    console.error(`[razorpay-webhook] handler failed: ${(e as Error).message}`);
  }
  // Always 200 — Razorpay retries on non-2xx and we've already done
  // best-effort work.
  return NextResponse.json({ ok: true });
}

async function handleCaptured(
  orderId: string,
  event: ReturnType<typeof RazorpayWebhookEventSchema.parse>,
  meta: Record<string, unknown>,
): Promise<void> {
  const payment = await prisma.billingPayment.findUnique({
    where: { razorpayOrderId: orderId },
    select: {
      id: true,
      psychologistId: true,
      billingAccountId: true,
      plan: true,
      amountInr: true,
      status: true,
    },
  });
  if (!payment) {
    console.warn(`[razorpay-webhook] captured event for unknown order ${orderId} (no-op)`);
    return;
  }
  if (payment.status === 'PAID') {
    // Idempotent — a re-delivered event is a no-op.
    return;
  }

  const plan: BillingPlan = payment.plan;
  const paymentId = event.payload?.payment?.entity?.id ?? null;

  await prisma.$transaction(async (tx) => {
    const account = await tx.billingAccount.findUnique({
      where: { id: payment.billingAccountId },
      select: { paidThroughAt: true },
    });
    const newPaidThrough = nextPaidThroughAt(plan, account?.paidThroughAt ?? null);
    const now = new Date();
    await tx.billingPayment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        ...(paymentId && { razorpayPaymentId: paymentId }),
        periodStart: now,
        periodEnd: newPaidThrough,
        rawEvent: event as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.billingAccount.update({
      where: { id: payment.billingAccountId },
      data: { plan, paidThroughAt: newPaidThrough },
    });

    // Two separate writes — chaos test sees the literals.
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'PAYMENT_RECEIVED',
        targetType: 'BillingPayment',
        targetId: payment.id,
        metadata: {
          ...meta,
          psychologistId: payment.psychologistId,
          plan,
          amountInr: payment.amountInr,
          razorpayOrderId: orderId,
        },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'PLAN_UPGRADED',
        targetType: 'BillingAccount',
        targetId: payment.billingAccountId,
        metadata: {
          ...meta,
          psychologistId: payment.psychologistId,
          plan,
          paidThroughAt: newPaidThrough.toISOString(),
        },
      },
      tx,
    );

    // Sprint 56 (Lever 3b) — if this payer was referred, the conversion
    // triggers the referrer's reward exactly once.
    const reward = await grantReferrerRewardOnConversion(tx, {
      referredPsychologistId: payment.psychologistId,
      now,
    });
    if (reward) {
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'REFERRAL_REWARDED',
          targetType: 'Psychologist',
          targetId: reward.referrerPsychologistId,
          metadata: {
            ...meta,
            referrerPsychologistId: reward.referrerPsychologistId,
            referredPsychologistId: payment.psychologistId,
            newPaidThroughAt: reward.newPaidThroughAt.toISOString(),
          },
        },
        tx,
      );
    }
  });
}

async function handleFailed(
  orderId: string,
  event: ReturnType<typeof RazorpayWebhookEventSchema.parse>,
  meta: Record<string, unknown>,
): Promise<void> {
  const payment = await prisma.billingPayment.findUnique({
    where: { razorpayOrderId: orderId },
    select: { id: true, psychologistId: true, status: true },
  });
  if (!payment) {
    console.warn(`[razorpay-webhook] failed event for unknown order ${orderId} (no-op)`);
    return;
  }
  if (payment.status === 'PAID') return; // Already paid — ignore stray failure.
  await prisma.$transaction(async (tx) => {
    await tx.billingPayment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        rawEvent: event as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'PAYMENT_FAILED',
        targetType: 'BillingPayment',
        targetId: payment.id,
        metadata: {
          ...meta,
          psychologistId: payment.psychologistId,
          razorpayOrderId: orderId,
        },
      },
      tx,
    );
  });
}
