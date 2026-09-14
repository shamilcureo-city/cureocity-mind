import { type NextRequest } from 'next/server';
import { MindWorkHistoryQuerySchema } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { privateJson, privateResponse } from '@/lib/private-response';
import { ClientPhiWriteForbiddenError } from '@/lib/phi-write-lock';
import { loadMindWorkHistoryPage } from '@/lib/mind-work-history-server';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const notFound = () => privateJson({ error: 'Client not found' }, { status: 404 });

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');
  if (!auth.ok) return privateResponse(auth.response);
  const documentation = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!documentation.ok) return privateResponse(documentation.response);
  if (auth.value.user.vertical !== 'THERAPIST') return notFound();
  const query = parseQuery(req.url, MindWorkHistoryQuerySchema);
  if (!query.ok) return privateResponse(query.response);
  const { id: clientId } = await params;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const page = await loadMindWorkHistoryPage(
          tx,
          clientId,
          auth.value.psychologistId,
          query.value,
        );
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'CLIENT_BRIEFING_VIEWED',
            targetType: 'Client',
            targetId: clientId,
            metadata: {
              ...auditMetadataFromRequest(req),
              surface: 'mind-session-work-history',
              snapshotVersion: page.snapshotVersion,
              beforeVersion: page.beforeVersion,
              outcome: 'viewed',
            },
          },
          tx,
        );
        return privateJson(page);
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return notFound();
    return privateJson(
      {
        error:
          'Saved work history could not be checked. It is not being treated as empty. Retry before relying on this history.',
      },
      { status: 503 },
    );
  }
}
