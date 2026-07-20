import { NextResponse, type NextRequest } from 'next/server';
import { UpdateAgreementInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH  — mark follow-up on an agreement (done / partly / not yet), from
 *          the NEXT session's Prepare card.
 * DELETE — remove an agreement recorded in error (pre-sign housekeeping).
 * Both audited `AGREEMENT_RECORDED` with an `op` in metadata.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agreementId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId, agreementId } = await params;

  const body = await parseJson(req, UpdateAgreementInputSchema);
  if (!body.ok) return body.response;

  const row = await prisma.sessionAgreement.findFirst({
    where: { id: agreementId, sessionId, psychologistId: auth.value.psychologistId },
    select: { id: true, clientId: true },
  });
  if (!row) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.sessionAgreement.update({
      where: { id: agreementId },
      data: { followUp: body.value.followUp, followUpAt: new Date() },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'AGREEMENT_RECORDED',
        targetType: 'SessionAgreement',
        targetId: agreementId,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          clientId: row.clientId,
          op: 'follow-up',
          followUp: body.value.followUp,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agreementId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId, agreementId } = await params;

  const row = await prisma.sessionAgreement.findFirst({
    where: { id: agreementId, sessionId, psychologistId: auth.value.psychologistId },
    select: { id: true, clientId: true },
  });
  if (!row) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.sessionAgreement.delete({ where: { id: agreementId } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'AGREEMENT_RECORDED',
        targetType: 'SessionAgreement',
        targetId: agreementId,
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          clientId: row.clientId,
          op: 'delete',
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
