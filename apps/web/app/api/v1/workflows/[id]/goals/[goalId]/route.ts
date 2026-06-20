import { NextResponse, type NextRequest } from 'next/server';
import {
  UpdateGoalInputSchema,
  type ModalityStateWithHistory,
  type WorkflowGoal,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toModalityStateWithHistory } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/workflows/[id]/goals/[goalId] — mark a single goal as
 * achieved or un-achieved. Used by the goal-checkbox in the workflow
 * card. Stamps achievedAt when transitioning false→true and clears it
 * on the reverse.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; goalId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id, goalId } = await params;
  const body = await parseJson(req, UpdateGoalInputSchema);
  if (!body.ok) return body.response;

  const state = await prisma.modalityState.findUnique({ where: { id } });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  const goals = (state.goals as WorkflowGoal[]) ?? [];
  const idx = goals.findIndex((g) => g.id === goalId);
  if (idx === -1) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  }

  const prev = goals[idx]!;
  const nextGoal: WorkflowGoal = {
    ...prev,
    achieved: body.value.achieved,
    achievedAt: body.value.achieved ? new Date().toISOString() : null,
    ...(body.value.evidence !== undefined && { evidence: body.value.evidence }),
  };
  const nextGoals = [...goals];
  nextGoals[idx] = nextGoal;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.modalityState.update({
      where: { id: state.id },
      data: {
        goals: nextGoals as unknown as Parameters<
          typeof tx.modalityState.update
        >[0]['data']['goals'],
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'WORKFLOW_GOAL_UPDATED',
        targetType: 'ModalityState',
        targetId: state.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          goalId,
          achieved: body.value.achieved,
          previouslyAchieved: prev.achieved,
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
