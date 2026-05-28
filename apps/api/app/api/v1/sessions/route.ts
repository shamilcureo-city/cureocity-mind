import { NextResponse, type NextRequest } from 'next/server';
import { CreateSessionInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions — create a session row in SCHEDULED state.
 * Cross-tenant ownership check folded inline (no separate guard).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, CreateSessionInputSchema);
  if (!dto.ok) return dto.response;

  const client = await prisma.client.findUnique({ where: { id: dto.value.clientId } });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.session.create({
      data: {
        clientId: dto.value.clientId,
        psychologistId: auth.value.psychologistId,
        modality: dto.value.modality,
        status: 'SCHEDULED',
        scheduledAt: new Date(dto.value.scheduledAt),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_CREATED',
        targetType: 'Session',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: dto.value.clientId,
          modality: dto.value.modality,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toSession(created), { status: 201 });
}
