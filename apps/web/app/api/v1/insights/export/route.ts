import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { insightsWindow } from '@/lib/insights';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS9 — GET /api/v1/insights/export?days=N
 *
 * The anonymised pilot dataset for the write-up: one row per copilot
 * consult (from LiveConsultMetric), no patient identifiers — the session id
 * is replaced by an opaque per-export index, and only length / cost /
 * throughput numbers are emitted. Doctor-vertical only, tenant-scoped.
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
  const metrics = await prisma.liveConsultMetric.findMany({
    where: { psychologistId: auth.value.psychologistId, createdAt: { gte: from, lt: to } },
    select: {
      createdAt: true,
      backend: true,
      costInr: true,
      elapsedMs: true,
      windows: true,
      transcriptP95Ms: true,
      noteP95Ms: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const header = [
    'consult_index',
    'day',
    'backend',
    'consult_minutes',
    'cost_inr',
    'windows',
    'transcript_p95_ms',
    'note_p95_ms',
  ];
  const rows = metrics.map((m, i) =>
    [
      i + 1,
      m.createdAt.toISOString().slice(0, 10),
      m.backend,
      (m.elapsedMs / 60_000).toFixed(2),
      Number(m.costInr).toFixed(4),
      m.windows,
      m.transcriptP95Ms,
      m.noteP95Ms,
    ].join(','),
  );
  const csv = [header.join(','), ...rows].join('\n') + '\n';

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cureocity-pilot-metrics.csv"`,
    },
  });
}
