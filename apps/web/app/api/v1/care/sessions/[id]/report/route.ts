import { NextResponse, type NextRequest } from 'next/server';
import { requireCareUserId } from '@/lib/care-auth';
import { runCareReport } from '@/lib/care-report';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/v1/care/sessions/[id]/report (AC4) — the synchronous Pass 10
 * re-run (the Pass-3 "Re-run now" pattern): the after() hook on /end can
 * be killed by the platform's duration cap, so the report screen offers
 * this path with its own 120 s budget.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { id: careSessionId } = await params;

  const session = await prisma.careSession.findUnique({
    where: { id: careSessionId },
    select: { id: true, careUserId: true, status: true },
  });
  if (!session || session.careUserId !== auth.value.careUserId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'COMPLETED' && session.status !== 'CRISIS_ESCALATED') {
    return NextResponse.json(
      { error: 'End the session before generating its report' },
      { status: 409 },
    );
  }

  const result = await runCareReport(careSessionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const report = await prisma.careReport.findUnique({
    where: { careSessionId },
    select: { id: true, kind: true, body: true },
  });
  return NextResponse.json({ report });
}
