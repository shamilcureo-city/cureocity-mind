import { NextResponse, type NextRequest } from 'next/server';
import { DsrErasureInputSchema, type DsrErasure } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/dsr/erasure-requests — DPDP § 15 erasure. Blocks
 * duplicate in-flight requests so the admin queue stays clean.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, DsrErasureInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const open = await prisma.clientErasureRequest.findFirst({
    where: { clientId, status: { in: ['PENDING', 'APPROVED'] } },
  });
  if (open) {
    return NextResponse.json(
      {
        error: `An erasure request is already in flight (id=${open.id}, status=${open.status})`,
      },
      { status: 400 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.clientErasureRequest.create({
      data: { clientId, reason: dto.value.reason ?? null },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'DSR_ERASURE_REQUESTED',
        targetType: 'ClientErasureRequest',
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          hasReason: dto.value.reason !== undefined,
        },
      },
      tx,
    );
    return created;
  });

  const body: DsrErasure = {
    id: row.id,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolutionNotes: row.resolutionNotes,
  };
  return NextResponse.json(body, { status: 201 });
}
