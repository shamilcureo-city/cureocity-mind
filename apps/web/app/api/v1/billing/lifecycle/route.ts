import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { ensureBillingAccount } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/billing/lifecycle — Sprint 56 (Lever 4 #4).
 *
 * Self-serve plan management. One route, three actions:
 *
 *   pause   — for an ACTIVE paid account: bank the remaining paid days
 *             (pausedRemainingDays), clear paidThroughAt so the clock
 *             stops, set status PAUSED. isPaidActive flips false; the
 *             therapist keeps their data but can't record new sessions.
 *   resume  — for a PAUSED account: paidThroughAt = now +
 *             pausedRemainingDays, status ACTIVE. Also reactivates a
 *             CANCELLED account (clears canceledAt) — the "changed my
 *             mind" path.
 *   cancel  — mark CANCELLED + canceledAt. Access continues until
 *             paidThroughAt lapses, but renewal reminders + dunning go
 *             quiet (the cron skips CANCELLED). Pause-instead-of-cancel
 *             is offered in the UI; this is the explicit cancel.
 *
 * Razorpay is one-time-orders (no auto-debit), so none of these touch
 * the payment provider — they only change our local lifecycle state.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const LifecycleInputSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, LifecycleInputSchema);
  if (!body.ok) return body.response;

  await ensureBillingAccount(auth.value.psychologistId);
  const account = await prisma.billingAccount.findUnique({
    where: { psychologistId: auth.value.psychologistId },
  });
  if (!account) {
    return NextResponse.json({ error: 'Billing account not found' }, { status: 404 });
  }

  const now = new Date();
  const auditMeta = auditMetadataFromRequest(req);

  if (body.value.action === 'pause') {
    const paidActive =
      account.plan !== 'FREE_TRIAL' &&
      account.paidThroughAt !== null &&
      account.paidThroughAt.getTime() > now.getTime();
    if (!paidActive || account.status === 'PAUSED') {
      return NextResponse.json(
        { error: 'Only an active paid plan can be paused.' },
        { status: 409 },
      );
    }
    const remainingDays = Math.max(
      0,
      Math.ceil((account.paidThroughAt!.getTime() - now.getTime()) / DAY_MS),
    );
    await prisma.$transaction(async (tx) => {
      await tx.billingAccount.update({
        where: { id: account.id },
        data: { status: 'PAUSED', pausedRemainingDays: remainingDays, paidThroughAt: null },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PLAN_PAUSED',
          targetType: 'BillingAccount',
          targetId: account.id,
          metadata: { ...auditMeta, plan: account.plan, bankedDays: remainingDays },
        },
        tx,
      );
    });
    return NextResponse.json({ status: 'PAUSED', bankedDays: remainingDays });
  }

  if (body.value.action === 'resume') {
    if (account.status === 'ACTIVE' && account.canceledAt === null) {
      return NextResponse.json({ error: 'Plan is already active.' }, { status: 409 });
    }
    // Restore the banked days (if paused); reactivating a cancel keeps
    // whatever paidThroughAt remains.
    const restored =
      account.status === 'PAUSED' && account.pausedRemainingDays !== null
        ? new Date(now.getTime() + account.pausedRemainingDays * DAY_MS)
        : account.paidThroughAt;
    await prisma.$transaction(async (tx) => {
      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          status: 'ACTIVE',
          paidThroughAt: restored,
          pausedRemainingDays: null,
          canceledAt: null,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PLAN_RESUMED',
          targetType: 'BillingAccount',
          targetId: account.id,
          metadata: {
            ...auditMeta,
            plan: account.plan,
            fromStatus: account.status,
            restoredPaidThroughAt: restored?.toISOString() ?? null,
          },
        },
        tx,
      );
    });
    return NextResponse.json({
      status: 'ACTIVE',
      paidThroughAt: restored?.toISOString() ?? null,
    });
  }

  // cancel
  if (account.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Plan is already cancelled.' }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.billingAccount.update({
      where: { id: account.id },
      data: { status: 'CANCELLED', canceledAt: now },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PLAN_CANCELLED',
        targetType: 'BillingAccount',
        targetId: account.id,
        metadata: {
          ...auditMeta,
          plan: account.plan,
          accessUntil: account.paidThroughAt?.toISOString() ?? null,
        },
      },
      tx,
    );
  });
  return NextResponse.json({
    status: 'CANCELLED',
    accessUntil: account.paidThroughAt?.toISOString() ?? null,
  });
}
