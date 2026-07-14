import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { CareShareCreateInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { computeCareWeeks } from '@/lib/care-streak';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CG6 — POST /api/v1/care/share — mint a pride-shaped share card.
 * Leak-proof BY CONSTRUCTION: the client sends only the KIND; every value
 * on the card is computed server-side from whitelisted numeric/milestone
 * facts. Suppression-gated (the ONE predicate). Never referral-incentivized.
 * VERDICT cards carry engine language plus the mandatory "one person's
 * numbers, not a promise" line (FTC/ASCI — causal claims were cut by the
 * ethics review). DELETE revokes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareShareCreateInputSchema);
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
    worseningVerdict: false,
  });
  if (suppression.suppress) {
    return NextResponse.json(
      { error: 'Sharing is paused right now — everything else is unaffected.' },
      { status: 403 },
    );
  }

  const snapshot = await buildSnapshot(careUserId, input.value.kind);
  if (!snapshot) {
    return NextResponse.json(
      { error: 'There is nothing to put on this card yet.' },
      { status: 409 },
    );
  }

  const token = randomBytes(12).toString('hex');
  const card = await prisma.careShareCard.create({
    data: { careUserId, token, kind: input.value.kind, snapshot },
  });
  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_SHARE_CREATED',
    targetType: 'CareShareCard',
    targetId: card.id,
    metadata: { ...auditMetadataFromRequest(req), kind: input.value.kind },
  });
  return NextResponse.json({ token, url: `/care/s/${token}` });
}

/** DELETE /api/v1/care/share?token=… — revoke; the page stops rendering it. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const card = await prisma.careShareCard.findUnique({ where: { token } });
  if (!card || card.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }
  await prisma.careShareCard.update({
    where: { id: card.id },
    data: { revokedAt: new Date() },
  });
  await writeAudit({
    actorType: 'CLIENT',
    action: 'CARE_SHARE_REVOKED',
    targetType: 'CareShareCard',
    targetId: card.id,
    metadata: auditMetadataFromRequest(req),
  });
  return NextResponse.json({ ok: true });
}

async function buildSnapshot(
  careUserId: string,
  kind: 'MILESTONE' | 'VERDICT' | 'GRADUATION',
): Promise<object | null> {
  if (kind === 'MILESTONE' || kind === 'GRADUATION') {
    const [sessions, checkins] = await Promise.all([
      prisma.careSession.findMany({
        where: { careUserId, status: 'COMPLETED' },
        select: { endedAt: true },
      }),
      prisma.careCheckin.findMany({ where: { careUserId }, select: { createdAt: true } }),
    ]);
    const record = computeCareWeeks({
      sessionDates: sessions.map((s) => s.endedAt).filter((d): d is Date => d !== null),
      checkinDates: checkins.map((c) => c.createdAt),
    });
    if (record.totalSessions === 0) return null;
    if (kind === 'GRADUATION') {
      const user = await prisma.careUser.findUnique({
        where: { id: careUserId },
        select: { graduatedAt: true },
      });
      if (!user?.graduatedAt) return null; // Only real graduates mint this card.
    }
    return {
      weeks: record.weeks,
      totalSessions: record.totalSessions,
      totalCheckins: record.totalCheckins,
    };
  }

  // VERDICT — the latest reliable-change movement, engine numbers only.
  const responses = await prisma.careInstrumentResponse.findMany({
    where: { careUserId },
    orderBy: { createdAt: 'asc' },
    select: { instrumentKey: true, totalScore: true },
  });
  for (const key of ['PHQ9', 'GAD7']) {
    const series = responses.filter((r) => r.instrumentKey === key);
    if (series.length >= 2) {
      const baseline = series[0]!.totalScore;
      const latest = series[series.length - 1]!.totalScore;
      if (latest < baseline) {
        return { instrumentKey: key, baselineScore: baseline, latestScore: latest };
      }
    }
  }
  return null;
}
