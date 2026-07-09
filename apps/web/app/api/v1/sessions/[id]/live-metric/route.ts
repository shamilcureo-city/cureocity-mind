import { NextResponse, type NextRequest } from 'next/server';
import { MeterSummarySchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS0 — POST /api/v1/sessions/:id/live-metric
 *
 * The streaming gateway meters every live consult (tokens / cost / latency
 * per window) but can't touch the DB, so the browser relays the gateway's
 * final `meter` summary here. We persist one LiveConsultMetric row per
 * consult — the record that keeps the unit economics honest (≤ ₹2 / consult,
 * transcript p95 ≤ 2s). Doctor-only, tenant-checked, POST-only (a side
 * effect must never be reachable by a prefetched GET — see docs/AUTH_SESSION.md).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const parsed = await parseJson(req, MeterSummarySchema);
  if (!parsed.ok) return parsed.response;
  const summary = parsed.value;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  // Sprint TS1 — both verticals record live-consult metrics (generic telemetry).

  const metric = await prisma.liveConsultMetric.create({
    data: {
      // The URL param + auth are authoritative; the body is telemetry.
      sessionId,
      psychologistId: auth.value.psychologistId,
      backend: summary.backend,
      windows: summary.windows,
      pass1Calls: summary.pass1Calls,
      pass2Calls: summary.pass2Calls,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      costInr: summary.costInr,
      transcriptP50Ms: summary.transcriptP50Ms,
      transcriptP95Ms: summary.transcriptP95Ms,
      // DOC-9 — the honest speech→transcript latency (window-wait included).
      speechToTranscriptP50Ms: summary.speechToTranscriptP50Ms,
      speechToTranscriptP95Ms: summary.speechToTranscriptP95Ms,
      noteP50Ms: summary.noteP50Ms,
      noteP95Ms: summary.noteP95Ms,
      elapsedMs: summary.elapsedMs,
    },
    select: { id: true },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'LIVE_CONSULT_METERED',
    targetType: 'LiveConsultMetric',
    targetId: metric.id,
    metadata: {
      sessionId,
      backend: summary.backend,
      windows: summary.windows,
      costInr: summary.costInr,
      transcriptP95Ms: summary.transcriptP95Ms,
      ...auditMetadataFromRequest(req),
    },
  });

  return NextResponse.json({ id: metric.id }, { status: 201 });
}
