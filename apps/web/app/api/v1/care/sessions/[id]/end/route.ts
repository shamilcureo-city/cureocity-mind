import { NextResponse, type NextRequest, after } from 'next/server';
import { EndCareSessionInputSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { runCareReport } from '@/lib/care-report';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/v1/care/sessions/[id]/end (AC3) — mood-after, close the
 * session, kick Pass 10 in after() (the Pass-3 pattern; the report
 * screen polls GET /sessions/[id] and can force the synchronous
 * POST /report re-run if after() gets killed by the platform cap).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;
  const input = await parseJson(req, EndCareSessionInputSchema);
  if (!input.ok) return input.response;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: { id: true, careUserId: true, status: true, startedAt: true },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status === 'COMPLETED' || session.status === 'CRISIS_ESCALATED') {
    // Idempotent: mood-after can still land on a crisis-ended session.
    if (input.value.moodAfter !== undefined) {
      await prisma.careSession.update({
        where: { id: careSessionId },
        data: { moodAfter: input.value.moodAfter },
      });
    }
    return NextResponse.json({ status: session.status });
  }

  const now = new Date();
  const durationSec = session.startedAt
    ? Math.max(0, Math.round((now.getTime() - session.startedAt.getTime()) / 1000))
    : 0;

  await prisma.$transaction(async (tx) => {
    await tx.careSession.update({
      where: { id: careSessionId },
      data: {
        status: 'COMPLETED',
        endedAt: now,
        durationSec,
        moodAfter: input.value.moodAfter ?? null,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_SESSION_COMPLETED',
        targetType: 'CareSession',
        targetId: careSessionId,
        metadata: { ...auditMetadataFromRequest(req), durationSec },
      },
      tx,
    );
  });

  after(async () => {
    const result = await runCareReport(careSessionId);
    if (!result.ok) {
      console.error(`[care] after() Pass 10 failed for ${careSessionId}: ${result.error}`);
    }
  });

  return NextResponse.json({ status: 'COMPLETED', durationSec });
}
