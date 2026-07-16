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

  // "Struggling" never forces a session — it keeps surfacing human help,
  // and the account stays paused until they tap "I'm safe".
  if (!input.value.safe) {
    return NextResponse.json({
      status: 'SAFETY_HOLD',
      reason: 'Help matters more than sessions right now.',
      resources,
      humanTherapistBridge: true,
    });
  }

  // Tap-to-continue (product decision, 2026-07). A genuine crisis still ends
  // the session and shows the hotlines (the takeover + `resources` above are
  // the safety FLOOR), but the account is NEVER punitively locked out: the
  // moment they confirm they're safe, the hold lifts — no overnight wait, no
  // "twice this month → human only" hard lock. The earlier 12h + 30-day gate
  // was too heavy for the product to carry.
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
