import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { insightsWindow, loadDoctorInsights } from '@/lib/insights';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS9 — GET /api/v1/insights?days=N
 *
 * The pilot-metrics rollup for the calling doctor over the last N IST clinic
 * days (default 1 = today). Doctor-vertical only, tenant-scoped. Read-only —
 * every number is composed from data already written (DS0 meter + DS3/DS6
 * suggestion audit + sessions).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const me = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { vertical: true },
  });
  if (me?.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'Insights are for the doctor vertical only.' },
      { status: 409 },
    );
  }

  const { from, to } = insightsWindow(req.url);
  const insights = await loadDoctorInsights(auth.value.psychologistId, from, to);
  return NextResponse.json(insights);
}
