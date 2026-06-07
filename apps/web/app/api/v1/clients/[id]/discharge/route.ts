import { NextResponse, type NextRequest } from 'next/server';
import type { ClientStatus as PrismaClientStatus } from '@prisma/client';
import { DischargeClientInputSchema, type TreatmentEpisode } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/discharge — close the client's active
 * treatment episode (Sprint 20 Phase 3).
 *
 * Closes the OPEN episode (creating a back-dated one if a legacy client
 * has sessions but no episode row yet) and mirrors the terminal state
 * onto Client.status so the clients list reflects it. Writes
 * TREATMENT_EPISODE_CLOSED. The therapist typically follows this by
 * sharing a final progress report (the patient-facing outcome).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const dto = await parseJson(req, DischargeClientInputSchema);
  if (!dto.ok) return dto.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // The client status mirrors the episode terminal state so the
  // clients list + filters stay consistent.
  const nextClientStatus: PrismaClientStatus =
    dto.value.status === 'TRANSFERRED' ? 'TRANSFERRED' : 'DISCHARGED';

  const closed = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const open = await tx.treatmentEpisode.findFirst({
      where: { clientId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });

    let episodeRow;
    if (open) {
      episodeRow = await tx.treatmentEpisode.update({
        where: { id: open.id },
        data: {
          status: dto.value.status,
          closedAt: now,
          closeReason: dto.value.reason,
          outcomeNote: dto.value.outcomeNote ?? null,
        },
      });
    } else {
      // Legacy client with sessions but no episode row — back-date the
      // open to the first completed session so the episode duration is
      // meaningful, then immediately close it.
      const firstSession = await tx.session.findFirst({
        where: { clientId, status: 'COMPLETED' },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      });
      episodeRow = await tx.treatmentEpisode.create({
        data: {
          clientId,
          psychologistId: auth.value.psychologistId,
          status: dto.value.status,
          openedAt: firstSession?.scheduledAt ?? now,
          closedAt: now,
          closeReason: dto.value.reason,
          outcomeNote: dto.value.outcomeNote ?? null,
        },
      });
    }

    await tx.client.update({
      where: { id: clientId },
      data: { status: nextClientStatus },
    });

    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'TREATMENT_EPISODE_CLOSED',
        targetType: 'TreatmentEpisode',
        targetId: episodeRow.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          status: dto.value.status,
          reason: dto.value.reason,
        },
      },
      tx,
    );

    return episodeRow;
  });

  const episode: TreatmentEpisode = {
    id: closed.id,
    clientId: closed.clientId,
    psychologistId: closed.psychologistId,
    status: closed.status,
    openedAt: closed.openedAt.toISOString(),
    closedAt: closed.closedAt?.toISOString() ?? null,
    closeReason: closed.closeReason,
    outcomeNote: closed.outcomeNote,
    createdAt: closed.createdAt.toISOString(),
    updatedAt: closed.updatedAt.toISOString(),
  };
  return NextResponse.json({ episode });
}
