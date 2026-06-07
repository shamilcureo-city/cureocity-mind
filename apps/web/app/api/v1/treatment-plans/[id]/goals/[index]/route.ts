import { NextResponse, type NextRequest } from 'next/server';
import { UpdateGoalProgressInputSchema, type GoalProgress } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/treatment-plans/[id]/goals/[index]
 *
 * Sprint 20 Phase 3 follow-up — toggle a single goal's achievement
 * status (NOT_STARTED / IN_PROGRESS / ACHIEVED). Upserts a
 * TreatmentGoalProgress row keyed by (treatmentPlanId, goalIndex) and
 * audits the change. The status lives in a side table so it never
 * re-versions the plan.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: treatmentPlanId, index: rawIndex } = await params;

  const goalIndex = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(goalIndex) || goalIndex < 0) {
    return NextResponse.json({ error: 'Invalid goal index' }, { status: 400 });
  }

  const dto = await parseJson(req, UpdateGoalProgressInputSchema);
  if (!dto.ok) return dto.response;

  const plan = await prisma.treatmentPlan.findUnique({
    where: { id: treatmentPlanId },
    select: { id: true, psychologistId: true, body: true },
  });
  if (!plan || plan.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Treatment plan not found' }, { status: 404 });
  }

  // Guard the index against the actual goals array so a stale UI can't
  // create progress rows for goals that don't exist.
  const goalCount = countGoals(plan.body);
  if (goalIndex >= goalCount) {
    return NextResponse.json(
      { error: `Goal index ${goalIndex} is out of range (plan has ${goalCount} goals)` },
      { status: 400 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const upserted = await tx.treatmentGoalProgress.upsert({
      where: { treatmentPlanId_goalIndex: { treatmentPlanId, goalIndex } },
      update: { status: dto.value.status, updatedByPsychologistId: auth.value.psychologistId },
      create: {
        treatmentPlanId,
        goalIndex,
        status: dto.value.status,
        updatedByPsychologistId: auth.value.psychologistId,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'TREATMENT_GOAL_PROGRESS_UPDATED',
        targetType: 'TreatmentPlan',
        targetId: treatmentPlanId,
        metadata: {
          ...auditMetadataFromRequest(req),
          goalIndex,
          status: dto.value.status,
        },
      },
      tx,
    );
    return upserted;
  });

  const result: GoalProgress = {
    treatmentPlanId: row.treatmentPlanId,
    goalIndex: row.goalIndex,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
  return NextResponse.json({ goalProgress: result });
}

function countGoals(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  const goals = (body as { goals?: unknown }).goals;
  return Array.isArray(goals) ? goals.length : 0;
}
