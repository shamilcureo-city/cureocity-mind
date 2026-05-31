import { NextResponse, type NextRequest } from 'next/server';
import { DsrGrievanceInputSchema, type DsrGrievance } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/dsr/grievances — DPDP § 14 grievance. Admin
 * resolves via the queue UI (Sprint 11+); this endpoint just creates
 * the OPEN row + audits.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, DsrGrievanceInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.clientGrievance.create({
      data: { clientId, subject: dto.value.subject, body: dto.value.body },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'DSR_GRIEVANCE_FILED',
        targetType: 'ClientGrievance',
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          subjectLength: dto.value.subject.length,
          bodyLength: dto.value.body.length,
        },
      },
      tx,
    );
    return created;
  });

  const body: DsrGrievance = {
    id: row.id,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
  return NextResponse.json(body, { status: 201 });
}
