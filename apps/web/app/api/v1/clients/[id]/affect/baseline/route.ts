import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { computeBaseline, loadSessionPoints } from '@/lib/affect-engine';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/affect/baseline — computes the per-client
 * affect baseline (valence + arousal mean / stddev) from the most
 * recent COMPLETED sessions' NoteDraft.affectFeatures. Returns
 * status=INSUFFICIENT_DATA until we have ≥ AFFECT_MIN_SESSIONS
 * sessions with affect features.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const points = await loadSessionPoints(clientId);
  const baseline = computeBaseline(clientId, points);

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'AFFECT_BASELINE_VIEWED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      status: baseline.status,
      sessionsUsed: baseline.sessionsUsed,
    },
  });

  return NextResponse.json(baseline);
}
