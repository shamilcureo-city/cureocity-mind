import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { crisisResources } from '@/lib/care-safety';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ResumeInputSchema = z.object({
  /** "Right now, I am…" — false = "struggling, show me help". */
  safe: z.boolean(),
});

/**
 * POST /api/v1/care/safety/resume (AC6, §2 layer 5) — the next-day
 * check-in that lifts a SAFETY_HOLD. Rules, all deterministic:
 *  - "struggling" never lifts the hold; it routes to resources.
 *  - a second crisis event within 30 days keeps sessions locked and
 *    promotes the human-help bridge (the response says so plainly).
 *  - the hold must be at least ~12h old ("next-day"), so the takeover
 *    can't be dismissed minutes later while still activated.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUser, careUserId } = auth.value;
  const input = await parseJson(req, ResumeInputSchema);
  if (!input.ok) return input.response;

  if (careUser.status !== 'SAFETY_HOLD') {
    return NextResponse.json({ status: careUser.status });
  }
  const resources = crisisResources(careUser.spokenLanguages);

  if (!input.value.safe) {
    return NextResponse.json({
      status: 'SAFETY_HOLD',
      reason: 'Help matters more than sessions right now.',
      resources,
      humanTherapistBridge: true,
    });
  }

  const holdAgeMs = careUser.safetyHoldAt
    ? Date.now() - careUser.safetyHoldAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (holdAgeMs < 12 * 60 * 60 * 1000) {
    return NextResponse.json({
      status: 'SAFETY_HOLD',
      reason:
        "Let's give it until tomorrow. Sessions unlock after a night's rest — help is one tap away until then.",
      resources,
    });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentCrises = await prisma.careSession.count({
    where: { careUserId, crisisAt: { gte: thirtyDaysAgo } },
  });
  if (recentCrises >= 2) {
    return NextResponse.json({
      status: 'SAFETY_HOLD',
      reason:
        'This has come up more than once this month — that deserves a person, not an AI. Sessions stay paused; a licensed therapist is the right next step.',
      resources,
      humanTherapistBridge: true,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.careUser.update({
      where: { id: careUserId },
      data: { status: 'ACTIVE', safetyHoldAt: null },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_SAFETY_HOLD_LIFTED',
        targetType: 'CareUser',
        targetId: careUserId,
        metadata: auditMetadataFromRequest(req),
      },
      tx,
    );
  });

  return NextResponse.json({ status: 'ACTIVE' });
}
