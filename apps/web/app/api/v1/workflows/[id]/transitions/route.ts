import { NextResponse, type NextRequest } from 'next/server';
import {
  CreateTransitionInputSchema,
  type ModalityStateWithHistory,
} from '@cureocity/contracts';
import {
  checkCbtTransition,
  checkEmdrTransition,
  isCbtPhase,
  isEmdrPhase,
} from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toModalityStateWithHistory } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/workflows/[id]/transitions — record a phase transition.
 *
 * Validates the transition via the clinical package's state machine
 * (CBT or EMDR depending on the workflow's modality). Always records as
 * PSYCHOLOGIST_MANUAL trigger from this endpoint — the SYSTEM_SUGGESTION_
 * ACCEPTED variant is wired separately when the therapist accepts the
 * GET /advancement-suggestion output (Sprint 3b PR 3).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, CreateTransitionInputSchema);
  if (!body.ok) return body.response;

  const state = await prisma.modalityState.findUnique({ where: { id } });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  if (state.completedAt) {
    return NextResponse.json(
      { error: 'Cannot transition a completed workflow' },
      { status: 409 },
    );
  }

  // Modality-specific transition check from the clinical state machine.
  if (state.modality === 'CBT') {
    if (!isCbtPhase(state.currentPhase) || !isCbtPhase(body.value.toPhase)) {
      return NextResponse.json(
        { error: `CBT phase invalid (from='${state.currentPhase}' to='${body.value.toPhase}')` },
        { status: 400 },
      );
    }
    const check = checkCbtTransition(state.currentPhase, body.value.toPhase);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? 'Transition not allowed' }, { status: 422 });
    }
  } else {
    if (!isEmdrPhase(state.currentPhase) || !isEmdrPhase(body.value.toPhase)) {
      return NextResponse.json(
        { error: `EMDR phase invalid (from='${state.currentPhase}' to='${body.value.toPhase}')` },
        { status: 400 },
      );
    }
    // EMDR uses prerequisite flags that we maintain inside ModalityState.state
    // (set by the dedicated EMDR endpoints in Sprint 4). Default to false
    // so phase-2-or-later transitions are blocked until those endpoints land.
    const emdrState = (state.state as Record<string, unknown>) ?? {};
    const check = checkEmdrTransition(state.currentPhase, body.value.toPhase, {
      preparationComplete: Boolean(emdrState['preparationComplete']),
      hasTargets: Boolean(emdrState['hasTargets']),
    });
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? 'Transition not allowed' }, { status: 422 });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const transition = await tx.modalityTransition.create({
      data: {
        stateId: state.id,
        fromPhase: state.currentPhase,
        toPhase: body.value.toPhase,
        trigger: 'PSYCHOLOGIST_MANUAL',
        reason: body.value.reason,
        psychologistId: auth.value.psychologistId,
        evidence: (body.value.evidence ?? {}) as Parameters<typeof tx.modalityTransition.create>[0]['data']['evidence'],
      },
    });
    await tx.modalityState.update({
      where: { id: state.id },
      data: { currentPhase: body.value.toPhase },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'WORKFLOW_PHASE_TRANSITIONED',
        targetType: 'ModalityState',
        targetId: state.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          fromPhase: state.currentPhase,
          toPhase: body.value.toPhase,
          transitionId: transition.id,
          reason: body.value.reason,
        },
      },
      tx,
    );
    return tx.modalityState.findUniqueOrThrow({
      where: { id: state.id },
      include: { transitions: { orderBy: { occurredAt: 'asc' } } },
    });
  });

  const response: ModalityStateWithHistory = toModalityStateWithHistory(updated);
  return NextResponse.json(response);
}
