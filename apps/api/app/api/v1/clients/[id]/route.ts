import { NextResponse, type NextRequest } from 'next/server';
import { UpdateClientInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toClient } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedClient(psychologistId: string, clientId: string) {
  const row = await prisma.client.findUnique({ where: { id: clientId } });
  if (!row || row.deletedAt !== null) return null;
  if (row.psychologistId !== psychologistId) return null;
  return row;
}

/**
 * GET /api/v1/clients/:id — single read + CLIENT_VIEWED audit row.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await fetchOwnedClient(auth.value.psychologistId, id);
  if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLIENT_VIEWED',
    targetType: 'Client',
    targetId: id,
    metadata: auditMetadataFromRequest(req),
  });
  return NextResponse.json(toClient(row));
}

/**
 * PATCH /api/v1/clients/:id — partial update. Writes a CLIENT_UPDATED
 * audit row with both before + after captured in metadata.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const existing = await fetchOwnedClient(auth.value.psychologistId, id);
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  const dto = await parseJson(req, UpdateClientInputSchema);
  if (!dto.ok) return dto.response;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.client.update({
      where: { id },
      data: {
        ...(dto.value.fullName !== undefined && { fullName: dto.value.fullName }),
        ...(dto.value.contactPhone !== undefined && { contactPhone: dto.value.contactPhone }),
        ...(dto.value.contactEmail !== undefined && { contactEmail: dto.value.contactEmail }),
        ...(dto.value.dateOfBirth !== undefined && {
          dateOfBirth: dto.value.dateOfBirth ? new Date(dto.value.dateOfBirth) : null,
        }),
        ...(dto.value.presentingConcerns !== undefined && {
          presentingConcerns: dto.value.presentingConcerns,
        }),
        ...(dto.value.preferredModality !== undefined && {
          preferredModality: dto.value.preferredModality,
        }),
        ...(dto.value.status !== undefined && { status: dto.value.status }),
      },
    });
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(dto.value) as (keyof typeof dto.value)[]) {
      before[key] = (existing as unknown as Record<string, unknown>)[key];
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_UPDATED',
        targetType: 'Client',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), before, after: dto.value },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toClient(updated));
}
