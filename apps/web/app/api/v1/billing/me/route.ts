import { NextResponse, type NextRequest } from 'next/server';
import type {
  BillingAccount,
  BillingMeResponse,
  BillingPayment,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { ensureBillingAccount, getEntitlement } from '@/lib/billing';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/billing/me — Sprint 53.
 *
 * Returns the calling therapist's billing account + entitlement
 * summary + recent payments. Used by the Settings → Plan page and
 * polled by the checkout success handler after Razorpay returns.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  await ensureBillingAccount(auth.value.psychologistId);
  const [accountRow, entitlement, recentRows] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { psychologistId: auth.value.psychologistId } }),
    getEntitlement(auth.value.psychologistId),
    prisma.billingPayment.findMany({
      where: { psychologistId: auth.value.psychologistId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  if (!accountRow) {
    return NextResponse.json({ error: 'Billing account not found' }, { status: 404 });
  }

  const account: BillingAccount = {
    id: accountRow.id,
    psychologistId: accountRow.psychologistId,
    plan: accountRow.plan,
    status: accountRow.status,
    trialSessionCap: accountRow.trialSessionCap,
    paidThroughAt: accountRow.paidThroughAt?.toISOString() ?? null,
    pausedRemainingDays: accountRow.pausedRemainingDays,
    canceledAt: accountRow.canceledAt?.toISOString() ?? null,
    createdAt: accountRow.createdAt.toISOString(),
    updatedAt: accountRow.updatedAt.toISOString(),
  };

  const recentPayments: BillingPayment[] = recentRows.map((p) => ({
    id: p.id,
    psychologistId: p.psychologistId,
    billingAccountId: p.billingAccountId,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    plan: p.plan,
    amountInr: p.amountInr,
    status: p.status,
    periodStart: p.periodStart?.toISOString() ?? null,
    periodEnd: p.periodEnd?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const body: BillingMeResponse = { account, entitlement, recentPayments };
  return NextResponse.json(body);
}
