import { NextResponse, type NextRequest } from 'next/server';
import { DsrErasureInputSchema, type DsrErasure } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/dsr/erasure — DPDP § 15 Right to
 * Erasure. Records the request as PENDING; the actual data
 * deletion is gated through an admin review path (ongoing-care
 * implications, statutory record-keeping in some cases). The
 * fulfilment endpoint and admin queue UI ship in a follow-up;
 * this lands the requested status + audit row so the regulator's
 * 30-day clock is bound.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, DsrErasureInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.clientErasureRequest.create({
      data: {
        clientId,
        ...(body.value.reason !== undefined && { reason: body.value.reason }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'DSR_ERASURE_REQUESTED',
        targetType: 'ClientErasureRequest',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          onBehalfOf: clientId,
        },
      },
      tx,
    );
    return row;
  });

  const response: DsrErasure = {
    id: created.id,
    status: created.status,
    reason: created.reason,
    createdAt: created.createdAt.toISOString(),
    resolvedAt: created.resolvedAt?.toISOString() ?? null,
    resolutionNotes: created.resolutionNotes,
  };
  return NextResponse.json(response, { status: 201 });
}
