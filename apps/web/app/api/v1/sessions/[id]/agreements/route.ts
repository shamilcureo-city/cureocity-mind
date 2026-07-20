import { NextResponse, type NextRequest } from 'next/server';
import { CreateAgreementInputSchema, type SessionAgreementDto } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Session Loop (SL1) — "what we agreed". One row per agreement made in
 * the room, in the client's words where possible. The next session's Prepare
 * card reads these back and marks follow-up.
 *
 * GET  — this session's agreements.
 * POST — record one agreement (audited `AGREEMENT_RECORDED`).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, psychologistId: auth.value.psychologistId },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const rows = await prisma.sessionAgreement.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
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
    where: { id: sessionId, psychologistId: auth.value.psychologistId },
    select: { id: true, clientId: true },
  });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const count = await prisma.sessionAgreement.count({ where: { sessionId } });
  if (count >= 8) {
    return NextResponse.json(
      { error: 'A session carries at most 8 agreements — fewer, kept, beats many, forgotten.' },
      { status: 422 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.sessionAgreement.create({
      data: {
        sessionId,
        clientId: session.clientId,
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
    return created;
  });

  const dto: SessionAgreementDto = {
    id: row.id,
    sessionId: row.sessionId,
    text: row.text,
    speaker: row.speaker,
    followUp: row.followUp,
    createdAt: row.createdAt.toISOString(),
  };
  return NextResponse.json({ agreement: dto }, { status: 201 });
}
