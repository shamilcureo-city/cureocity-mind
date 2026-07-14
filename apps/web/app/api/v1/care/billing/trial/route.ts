import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * CG5 — POST /api/v1/care/billing/trial — the 7-day no-card Plus trial.
 * One-shot per account (server-enforced), no payment method collected
 * (sidesteps UPI-mandate friction entirely), ends SILENTLY back to Free —
 * the gate computes the effective tier, so there is no countdown banner
 * and nothing to cancel. POST-only per the side-effect rule.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUser, careUserId } = auth.value;

  // The same ONE suppression predicate as every commerce surface.
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
    worseningVerdict: false,
  });
  if (suppression.suppress) {
    return NextResponse.json(
      { error: 'Trials are paused right now — your sessions stay free and unaffected.' },
      { status: 403 },
    );
  }

  const row = await prisma.careUser.findUniqueOrThrow({
    where: { id: careUserId },
    select: { plusTrialStartedAt: true },
  });
  if (row.plusTrialStartedAt) {
    return NextResponse.json({ error: 'The trial has already been used.' }, { status: 409 });
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await prisma.careUser.update({
    where: { id: careUserId },
    data: { plusTrialStartedAt: now, plusTrialEndsAt: endsAt },
  });
  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_TRIAL_STARTED',
    targetType: 'CareUser',
    targetId: careUserId,
    metadata: { ...auditMetadataFromRequest(req), endsAt: endsAt.toISOString() },
  });

  return NextResponse.json({ ok: true, endsAt });
}
