import { NextResponse, type NextRequest } from 'next/server';
import { CareCheckoutInputSchema, type CareCheckoutResponse } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { carePlusMonthlyInr } from '@/lib/care-pricing';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { publicRazorpayKeyId, razorpay } from '@/lib/billing';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CG3 — POST /api/v1/care/billing/checkout. The Sprint-53 therapist
 * pattern, ported to Care: mint a Razorpay order (notes.careUserId is the
 * webhook's branch key), persist a CREATED CarePayment, return
 * order + key for Razorpay Checkout. The WEBHOOK is the source of truth —
 * never the checkout success callback.
 *
 * Suppression is enforced HERE, not just in the UI (ethics charter #2):
 * a held / recently-in-crisis / worsening account cannot even mint an
 * order — the Replika upsell-at-distress pattern is refused server-side.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareCheckoutInputSchema);
  if (!input.ok) return input.response;
  const { careUser, careUserId } = auth.value;

  const [lastCrisis, latestReport] = await Promise.all([
    prisma.careSession.findFirst({
      where: { careUserId, crisisAt: { not: null } },
      orderBy: { crisisAt: 'desc' },
      select: { crisisAt: true },
    }),
    prisma.careReport.findFirst({
      where: { careSession: { careUserId } },
      orderBy: { createdAt: 'desc' },
      select: { riskLevel: true },
    }),
  ]);
  const suppression = evaluateCareSuppression({
    status: careUser.status,
    safetyHoldAt: careUser.safetyHoldAt,
    lastCrisisAt: lastCrisis?.crisisAt ?? null,
    latestRiskLevel: latestReport?.riskLevel ?? null,
    worseningVerdict: false, // verdicts require ≥2 scores; risk + crisis cover the acute cases here
  });
  if (suppression.suppress) {
    return NextResponse.json(
      {
        error:
          'Upgrades are paused right now — your sessions and safety support are unaffected and free.',
      },
      { status: 403 },
    );
  }

  const amountInr = carePlusMonthlyInr();
  const keyId = publicRazorpayKeyId();
  if (!keyId) {
    return NextResponse.json(
      { error: 'Payments are not configured on this deployment yet.' },
      { status: 500 },
    );
  }

  const receipt = `care_${careUserId.slice(0, 8)}_${Date.now()}`;
  const order = await razorpay().createOrder({
    amountPaise: amountInr * 100,
    receipt,
    notes: { careUserId, sku: input.value.sku },
  });

  const payment = await prisma.carePayment.create({
    data: {
      careUserId,
      razorpayOrderId: order.orderId,
      sku: input.value.sku,
      amountInr,
      status: 'CREATED',
    },
  });
  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_CHECKOUT_CREATED',
    targetType: 'CarePayment',
    targetId: payment.id,
    metadata: { ...auditMetadataFromRequest(req), sku: input.value.sku, amountInr },
  });

  const response: CareCheckoutResponse = { orderId: order.orderId, amountInr, keyId };
  return NextResponse.json(response);
}
