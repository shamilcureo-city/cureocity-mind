import { NextResponse, type NextRequest } from 'next/server';
import { AgreementRevisionHistorySchema, CreateAgreementInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { toSessionAgreementDto, withAgreementHomeworkAccess } from '@/lib/session-agreement-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Session Loop (SL1) — "what we agreed". One row per agreement made in
 * the room, in the client's words where possible. The next session's Prepare
 * card reads these back and marks follow-up.
 *
 * GET  — this session's agreements.
 * POST — record one agreement (audited `AGREEMENT_RECORDED`), or return the
 * existing receipt when the same creation is retried without a follow-up mark.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      psychologistId: auth.value.psychologistId,
      client: { is: { deletedAt: null } },
    },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  try {
    const rows = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      return tx.sessionAgreement.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        include: {
          session: { select: { scheduledAt: true } },
          homeworkAssignments: {
            select: {
              id: true,
              sourceAgreementRevision: true,
              customDescription: true,
              dueAt: true,
              status: true,
            },
            orderBy: { assignedAt: 'asc' },
          },
        },
      });
    });
    const agreements = rows.map((row) =>
      withAgreementHomeworkAccess(
        toSessionAgreementDto(row),
        auth.value.user?.capabilities?.includes('THERAPY_WORKFLOWS') ?? false,
      ),
    );
    return NextResponse.json({ agreements });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    throw error;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const body = await parseJson(req, CreateAgreementInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      psychologistId: auth.value.psychologistId,
      client: { is: { deletedAt: null } },
    },
    select: { id: true, clientId: true },
  });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      // Stable creation receipts survive later corrections and follow-up marks.
      // A retry returns the same canonical agreement, not a new stale copy.
      if (body.value.operationId) {
        const receipt = await tx.sessionAgreement.findFirst({
          where: {
            sessionId,
            clientId: client.id,
            psychologistId: auth.value.psychologistId,
            creationOperationId: body.value.operationId,
          },
        });
        if (receipt) {
          const history = AgreementRevisionHistorySchema.safeParse(receipt.revisions ?? []);
          if (!history.success || history.data.length !== receipt.revision)
            throw new AgreementCreationConflictError();
          const originalText = history.data[0]?.previousText ?? receipt.text;
          const originalSpeaker = history.data[0]?.previousSpeaker ?? receipt.speaker;
          if (originalText !== body.value.text || originalSpeaker !== body.value.speaker)
            throw new AgreementCreationConflictError();
          return { row: receipt, created: false };
        }
      }
      // Creation has followUp=null. Compare the schema-parsed text exactly:
      // retries cannot consume quota or emit another audit, while different
      // speakers/text and already-followed-up agreements remain distinct.
      // This lookup must happen under the same lock as quota/insert and before
      // the eight-row limit, including when the first attempt filled the quota.
      const existing = body.value.operationId
        ? null
        : await tx.sessionAgreement.findFirst({
            where: {
              sessionId,
              clientId: client.id,
              psychologistId: auth.value.psychologistId,
              text: body.value.text,
              speaker: body.value.speaker,
              followUp: null,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
      if (existing) return { row: existing, created: false };
      // Serialize quota and insert with erasure and other agreement writers.
      const count = await tx.sessionAgreement.count({ where: { sessionId } });
      if (count >= 8) return null;
      const created = await tx.sessionAgreement.create({
        data: {
          sessionId,
          clientId: client.id,
          psychologistId: auth.value.psychologistId,
          speaker: body.value.speaker,
          text: body.value.text,
          creationOperationId: body.value.operationId,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'AGREEMENT_RECORDED',
          targetType: 'SessionAgreement',
          targetId: created.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            clientId: session.clientId,
            op: 'create',
            speaker: body.value.speaker,
          },
        },
        tx,
      );
      return { row: created, created: true };
    });
    if (!saved)
      return NextResponse.json(
        { error: 'A session carries at most 8 agreements — fewer, kept, beats many, forgotten.' },
        { status: 422 },
      );
    const { row } = saved;
    const dto = withAgreementHomeworkAccess(
      toSessionAgreementDto(row),
      auth.value.user?.capabilities?.includes('THERAPY_WORKFLOWS') ?? false,
    );
    return NextResponse.json(
      { agreement: dto, operationId: body.value.operationId },
      { status: saved.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof AgreementCreationConflictError)
      return NextResponse.json(
        {
          error:
            'This save identifier was used for a different agreement. Reload before trying again.',
        },
        { status: 409 },
      );
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    throw error;
  }
}

class AgreementCreationConflictError extends Error {}
