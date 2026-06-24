import { NextResponse, type NextRequest } from 'next/server';
import { CreateProblemInputSchema, type ProblemListItem } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/problems — Sprint 67c.
 *
 * Add an item to the client's maintained problem list. Tenant-gated;
 * audits PROBLEM_LIST_ITEM_ADDED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, CreateProblemInputSchema);
  if (!dto.ok) return dto.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const row = await prisma.problemListItem.create({
    data: {
      clientId,
      psychologistId,
      title: dto.value.title,
      detail: dto.value.detail ?? null,
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'PROBLEM_LIST_ITEM_ADDED',
    targetType: 'ProblemListItem',
    targetId: row.id,
    metadata: { ...auditMetadataFromRequest(req), clientId },
  });

  const item: ProblemListItem = {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
  return NextResponse.json({ item }, { status: 201 });
}
