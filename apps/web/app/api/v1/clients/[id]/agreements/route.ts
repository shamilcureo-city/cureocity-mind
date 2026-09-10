import { type NextRequest } from 'next/server';
import { ActiveAgreementQuerySchema } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { loadActiveSessionAgreements } from '@/lib/active-session-agreements';
import { privateJson, privateResponse } from '@/lib/private-response';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST')
    return privateJson({ error: 'Not found' }, { status: 404 });
  const query = parseQuery(req.url, ActiveAgreementQuerySchema);
  if (!query.ok) return privateResponse(query.response);
  const { id: clientId } = await params;
  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return privateJson({ error: 'Client not found' }, { status: 404 });
  if (query.value.cursor) {
    const cursor = await prisma.sessionAgreement.findFirst({
      where: { id: query.value.cursor, clientId, psychologistId: auth.value.psychologistId },
      select: { id: true },
    });
    if (!cursor)
      return privateJson({ error: 'Commitment list changed. Reload the list.' }, { status: 409 });
  }
  const result = await loadActiveSessionAgreements(
    prisma,
    clientId,
    auth.value.psychologistId,
    query.value.cursor,
  );
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLIENT_BRIEFING_VIEWED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      surface: 'active-commitments',
      outcome: 'viewed',
    },
  });
  return privateJson(result);
}
