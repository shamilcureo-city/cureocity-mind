import { NextResponse, type NextRequest } from 'next/server';
import { DsrNominationInputSchema, type DsrNomination } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/dsr/nomination — DPDP § 13 Right to
 * Nominate. Records a trusted person who can act on the client's
 * data rights if the client is unable to. Any prior un-superseded
 * nomination is marked supersededAt=now in the same tx so there's
 * always at most one active nomination per client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, DsrNominationInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.clientNomination.updateMany({
      where: { clientId, supersededAt: null },
      data: { supersededAt: now },
    });
    const row = await tx.clientNomination.create({
      data: {
        clientId,
        nomineeName: body.value.nomineeName,
        nomineeRelation: body.value.nomineeRelation,
        nomineePhone: body.value.nomineePhone,
        ...(body.value.nomineeEmail !== undefined && { nomineeEmail: body.value.nomineeEmail }),
        ...(body.value.notes !== undefined && { notes: body.value.notes }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'DSR_NOMINATION_RECORDED',
        targetType: 'ClientNomination',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          onBehalfOf: clientId,
          relation: body.value.nomineeRelation,
        },
      },
      tx,
    );
    return row;
  });

  const response: DsrNomination = {
    id: created.id,
    nomineeName: created.nomineeName,
    nomineeRelation: created.nomineeRelation,
    nomineePhone: created.nomineePhone,
    nomineeEmail: created.nomineeEmail,
    notes: created.notes,
    createdAt: created.createdAt.toISOString(),
    supersededAt: created.supersededAt?.toISOString() ?? null,
  };
  return NextResponse.json(response, { status: 201 });
}
