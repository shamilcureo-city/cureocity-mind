import { NextResponse, type NextRequest } from 'next/server';
import { DsrNominationInputSchema, type DsrNomination } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/dsr/nominations — DPDP § 13 nomination. New
 * nomination supersedes any prior active one in the same tx so the
 * "only one active at a time" invariant holds.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, DsrNominationInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const row = await prisma.$transaction(async (tx) => {
    await tx.clientNomination.updateMany({
      where: { clientId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    const created = await tx.clientNomination.create({
      data: {
        clientId,
        nomineeName: dto.value.nomineeName,
        nomineeRelation: dto.value.nomineeRelation,
        nomineePhone: dto.value.nomineePhone,
        nomineeEmail: dto.value.nomineeEmail ?? null,
        notes: dto.value.notes ?? null,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'DSR_NOMINATION_RECORDED',
        targetType: 'ClientNomination',
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          nomineeRelation: dto.value.nomineeRelation,
        },
      },
      tx,
    );
    return created;
  });

  const body: DsrNomination = {
    id: row.id,
    nomineeName: row.nomineeName,
    nomineeRelation: row.nomineeRelation,
    nomineePhone: row.nomineePhone,
    nomineeEmail: row.nomineeEmail,
    notes: row.notes,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
  return NextResponse.json(body, { status: 201 });
}
