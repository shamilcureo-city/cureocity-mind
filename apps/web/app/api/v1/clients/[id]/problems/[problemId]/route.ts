import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { UpdateProblemInputSchema, type ProblemListItem } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; problemId: string }> };

/**
 * PATCH /api/v1/clients/[id]/problems/[problemId] — Sprint 67c.
 *
 * Edit an item or toggle its status. Resolving stamps resolvedAt;
 * reopening clears it. Tenant-gated; audits PROBLEM_LIST_ITEM_UPDATED.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, problemId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, UpdateProblemInputSchema);
  if (!dto.ok) return dto.response;

  const existing = await prisma.problemListItem.findUnique({
    where: { id: problemId },
    select: { clientId: true, psychologistId: true },
  });
  if (!existing || existing.psychologistId !== psychologistId || existing.clientId !== clientId) {
    return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
  }

  const data: Prisma.ProblemListItemUpdateInput = {};
  if (dto.value.title !== undefined) data.title = dto.value.title;
  if (dto.value.detail !== undefined) data.detail = dto.value.detail;
  if (dto.value.status !== undefined) {
    data.status = dto.value.status;
    data.resolvedAt = dto.value.status === 'RESOLVED' ? new Date() : null;
  }

  const row = await prisma.problemListItem.update({ where: { id: problemId }, data });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'PROBLEM_LIST_ITEM_UPDATED',
    targetType: 'ProblemListItem',
    targetId: row.id,
    metadata: { ...auditMetadataFromRequest(req), clientId, status: row.status },
  });

  const item: ProblemListItem = {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
  return NextResponse.json({ item });
}

/**
 * DELETE /api/v1/clients/[id]/problems/[problemId] — Sprint 67c.
 * Remove an item. Tenant-gated; audits PROBLEM_LIST_ITEM_REMOVED.
 */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, problemId } = await params;
  const psychologistId = auth.value.psychologistId;

  const existing = await prisma.problemListItem.findUnique({
    where: { id: problemId },
    select: { clientId: true, psychologistId: true },
  });
  if (!existing || existing.psychologistId !== psychologistId || existing.clientId !== clientId) {
    return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
  }

  await prisma.problemListItem.delete({ where: { id: problemId } });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'PROBLEM_LIST_ITEM_REMOVED',
    targetType: 'ProblemListItem',
    targetId: problemId,
    metadata: { ...auditMetadataFromRequest(req), clientId },
  });

  return NextResponse.json({ ok: true });
}
