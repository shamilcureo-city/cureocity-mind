import { NextResponse, type NextRequest } from 'next/server';
import { DsrGrievanceInputSchema, type DsrGrievance } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/dsr/grievance — DPDP § 14 Right to
 * Grievance. Files a complaint to be handled per the data
 * fiduciary's grievance redressal mechanism. Status starts at OPEN;
 * subsequent ACKNOWLEDGED / RESOLVED / CLOSED transitions go
 * through the admin queue (Sprint 9 follow-up).
 *
 * Subject + body are stored as plaintext for now — Sprint 9 PR 3
 * field-level encryption will wrap these alongside JournalEntry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, DsrGrievanceInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.clientGrievance.create({
      data: {
        clientId,
        subject: body.value.subject,
        body: body.value.body,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'DSR_GRIEVANCE_FILED',
        targetType: 'ClientGrievance',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          onBehalfOf: clientId,
          subject: body.value.subject,
        },
      },
      tx,
    );
    return row;
  });

  const response: DsrGrievance = {
    id: created.id,
    subject: created.subject,
    status: created.status,
    acknowledgedAt: created.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: created.resolvedAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
  };
  return NextResponse.json(response, { status: 201 });
}
