import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { istDayKey } from '@/lib/care-streak';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * CG4 — POST /api/v1/care/homework/tick — the tiny-habit loop's one tap.
 * One tick per IST day (idempotent on the unique constraint); ticks fold
 * into the case file so the next session opens on them ("You did the
 * breathing three nights — what did you notice?"). "Not done" days are
 * recorded nowhere and mentioned by nothing.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const istDay = istDayKey(new Date());

  try {
    const tick = await prisma.careHomeworkTick.create({
      data: { careUserId: auth.value.careUserId, istDay },
    });
    await writeAudit({
      actorType: 'CLIENT',
      action: 'CARE_HOMEWORK_TICKED',
      targetType: 'CareHomeworkTick',
      targetId: tick.id,
      metadata: { ...auditMetadataFromRequest(req), istDay },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e; // already ticked today
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ticksThisWeek = await prisma.careHomeworkTick.count({
    where: { careUserId: auth.value.careUserId, createdAt: { gte: weekAgo } },
  });
  return NextResponse.json({ ok: true, ticksThisWeek });
}
