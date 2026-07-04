import { NextResponse, type NextRequest } from 'next/server';
import { SetSessionProblemsInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/v1/sessions/[id]/problems — Sprint 73.
 *
 * Replace the full set of problem-list items this session worked on
 * (idempotent set semantics). Tenant-gated: the session and every
 * problem id must belong to the caller, and every problem must be on
 * the same client as the session (no cross-client tagging). Audits
 * SESSION_PROBLEMS_TAGGED.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, SetSessionProblemsInputSchema);
  if (!dto.ok) return dto.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, clientId: true },
  });
  if (!session || session.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // De-dupe and validate: every requested problem must belong to this
  // therapist AND this session's client.
  const requestedIds = [...new Set(dto.value.problemIds)];
  if (requestedIds.length > 0) {
    const owned = await prisma.problemListItem.findMany({
      where: { id: { in: requestedIds }, clientId: session.clientId, psychologistId },
      select: { id: true },
    });
    if (owned.length !== requestedIds.length) {
      return NextResponse.json(
        { error: 'One or more problems do not belong to this client.' },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.sessionProblemLink.deleteMany({ where: { sessionId } });
    if (requestedIds.length > 0) {
      await tx.sessionProblemLink.createMany({
        data: requestedIds.map((problemListItemId) => ({
          sessionId,
          problemListItemId,
          psychologistId,
        })),
        skipDuplicates: true,
      });
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psychologistId,
        action: 'SESSION_PROBLEMS_TAGGED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: session.clientId,
          problemIds: requestedIds,
          count: requestedIds.length,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ problemIds: requestedIds });
}
