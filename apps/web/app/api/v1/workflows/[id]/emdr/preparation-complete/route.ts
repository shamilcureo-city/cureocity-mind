import { NextResponse, type NextRequest } from 'next/server';
import { PreparationCompleteInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toModalityStateWithHistory } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/workflows/[id]/emdr/preparation-complete — flips the
 * EMDR Phase-2 (Preparation) gate to "complete" by writing
 * preparationComplete=true into ModalityState.state. This unlocks
 * transitions into assessment / desensitization / installation /
 * body_scan, which are gated in checkEmdrTransition by the same flag.
 *
 * The therapist confirms three Phase-2 prerequisites in the body:
 * safe-place installation, adequate resource development, and
 * dissociation screen — all hard true literals on the Zod schema, so
 * we can audit the confirmation as a single "yes" without ambiguity.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, PreparationCompleteInputSchema);
  if (!body.ok) return body.response;

  const state = await prisma.modalityState.findUnique({ where: { id } });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.modality !== 'EMDR') {
    return NextResponse.json({ error: 'preparation-complete is EMDR-only' }, { status: 422 });
  }
  if (state.completedAt) {
    return NextResponse.json({ error: 'Cannot update a completed workflow' }, { status: 409 });
  }

  const prevState = (state.state as Record<string, unknown>) ?? {};
  const nextState = {
    ...prevState,
    preparationComplete: true,
    preparationCompletedAt: new Date().toISOString(),
    safePlaceInstalled: true,
    resourcesAdequate: true,
    dissociationScreened: true,
    ...(body.value.notes !== undefined && { preparationNotes: body.value.notes }),
  };

  const updated = await prisma.$transaction(async (tx) => {
    await tx.modalityState.update({
      where: { id: state.id },
      data: {
        state: nextState as unknown as Parameters<
          typeof tx.modalityState.update
        >[0]['data']['state'],
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'EMDR_PREPARATION_COMPLETED',
        targetType: 'ModalityState',
        targetId: state.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          previouslyComplete: Boolean(prevState['preparationComplete']),
        },
      },
      tx,
    );
    return tx.modalityState.findUniqueOrThrow({
      where: { id: state.id },
      include: { transitions: { orderBy: { occurredAt: 'asc' } } },
    });
  });

  return NextResponse.json(toModalityStateWithHistory(updated));
}
