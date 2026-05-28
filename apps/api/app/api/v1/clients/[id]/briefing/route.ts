import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toBriefingSessionSummary, toClient, toConsent } from '@/lib/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/clients/:id/briefing — composed dossier: client +
 * consents + recent 10 sessions. Writes CLIENT_BRIEFING_VIEWED audit.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [consents, sessions] = await Promise.all([
    prisma.consent.findMany({
      where: { clientId: id },
      orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.session.findMany({
      where: { clientId: id },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
    }),
  ]);

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLIENT_BRIEFING_VIEWED',
    targetType: 'Client',
    targetId: id,
    metadata: auditMetadataFromRequest(req),
  });

  return NextResponse.json({
    client: toClient(client),
    consents: consents.map(toConsent),
    recentSessions: sessions.map(toBriefingSessionSummary),
    lastNote: null,
  });
}
