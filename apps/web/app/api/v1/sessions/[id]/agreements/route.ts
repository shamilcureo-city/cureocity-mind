import { NextResponse, type NextRequest } from 'next/server';
import { CreateAgreementInputSchema, type SessionAgreementDto } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';

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
      return tx.sessionAgreement.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    });
    const agreements: SessionAgreementDto[] = rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      text: r.text,
      speaker: r.speaker,
      followUp: r.followUp,
      createdAt: r.createdAt.toISOString(),
    }));
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
      // Creation has followUp=null. Compare the schema-parsed text exactly:
      // retries cannot consume quota or emit another audit, while different
      // speakers/text and already-followed-up agreements remain distinct.
      // This lookup must happen under the same lock as quota/insert and before
      // the eight-row limit, including when the first attempt filled the quota.
      const existing = await tx.sessionAgreement.findFirst({
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
    const dto: SessionAgreementDto = {
      id: row.id,
      sessionId: row.sessionId,
      text: row.text,
      speaker: row.speaker,
      followUp: row.followUp,
      createdAt: row.createdAt.toISOString(),
    };
    return NextResponse.json({ agreement: dto }, { status: saved.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    throw error;
  }
}
