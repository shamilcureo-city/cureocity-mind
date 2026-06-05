import { NextResponse, type NextRequest } from 'next/server';
import type { AffectTrend } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import {
  AFFECT_SIGMA_THRESHOLD,
  computeBaseline,
  findDeviations,
  loadSessionPoints,
} from '@/lib/affect-engine';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/affect/trend — returns the per-session
 * affect points, the baseline, and any sessions whose valence or
 * arousal sits outside ±AFFECT_SIGMA_THRESHOLD of the baseline mean
 * (neutral-language flags only — no clinical interpretation).
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
  const deviations = findDeviations(baseline, points);

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'AFFECT_TREND_VIEWED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      baselineStatus: baseline.status,
      pointCount: points.length,
      deviationCount: deviations.length,
    },
  });

  const response: AffectTrend = {
    clientId,
    baseline,
    points,
    deviations,
    sigmaThreshold: AFFECT_SIGMA_THRESHOLD,
  };
  return NextResponse.json(response);
}
