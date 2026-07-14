import { NextResponse, type NextRequest } from 'next/server';
import { requireCareUserId } from '@/lib/care-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/care/sessions/[id] (AC3/AC4) — session status + the report
 * body once Pass 10 lands. The done/report screen polls this.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: {
      id: true,
      careUserId: true,
      kind: true,
      status: true,
      topic: true,
      moodBefore: true,
      moodAfter: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
      report: { select: { id: true, kind: true, body: true, createdAt: true } },
    },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // CG1 — the report screen needs (a) the CURRENT plan's track/cadence so a
  // REVIEW revision carries them forward (a hardcoded 'CBT' default was
  // silently resetting SLEEP/GROUNDING users' tracks on plan v2), and (b)
  // whether a baseline instrument exists (drives the "starting line" ask).
  const [currentPlan, baselineCount, completedCount] = await Promise.all([
    prisma.carePlan.findFirst({
      where: { careUserId: auth.value.careUserId },
      orderBy: { version: 'desc' },
      select: { modalityTrack: true, cadence: true },
    }),
    prisma.careInstrumentResponse.count({ where: { careUserId: auth.value.careUserId } }),
    prisma.careSession.count({
      where: { careUserId: auth.value.careUserId, status: 'COMPLETED' },
    }),
  ]);

  return NextResponse.json({
    id: session.id,
    kind: session.kind,
    status: session.status,
    topic: session.topic,
    moodBefore: session.moodBefore,
    moodAfter: session.moodAfter,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSec: session.durationSec,
    currentPlan,
    hasBaseline: baselineCount > 0,
    completedCount,
    hasTrustedContact: auth.value.careUser.trustedContactName !== null,
    personaName: auth.value.careUser.personaName,
    report: session.report
      ? { id: session.report.id, kind: session.report.kind, body: session.report.body }
      : null,
  });
}
