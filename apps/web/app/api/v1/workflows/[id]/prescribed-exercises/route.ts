import { NextResponse, type NextRequest } from 'next/server';
import type { RiskSeverity } from '@cureocity/contracts';
import {
  recommendCbtExercises,
  recommendEmdrExercises,
  type AdherenceStat,
} from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/workflows/[id]/prescribed-exercises — runs the CBT
 * prescription engine for the workflow's current phase. Recent risk
 * severity is sourced from the 3 most-recent NoteDrafts for any
 * session on this client; adherence stats come from
 * ExerciseAssignment + ExerciseResponse joined.
 *
 * EMDR prescription ships in Sprint 4 alongside the EMDR catalog
 * wiring.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const state = await prisma.modalityState.findUnique({
    where: { id },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      modality: true,
      currentPhase: true,
    },
  });
  if (!state || state.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Recent risk severity — the most severe across the 3 most-recent
  // NoteDrafts for this client.
  const recentDrafts = await prisma.noteDraft.findMany({
    where: { session: { clientId: state.clientId }, riskSeverity: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { riskSeverity: true },
  });
  const recentRiskSeverity: RiskSeverity = pickHighestSeverity(
    recentDrafts.map((d) => d.riskSeverity).filter(Boolean) as string[],
  );

  // Adherence stats: per-exercise lastPrescribedAt + completionRate.
  // ExerciseAssignment.completedAt is the single source of truth (the
  // response Json field is opaque to us here). Rolling completion =
  // completed-count / total-count for each exercise id.
  const assignments = await prisma.exerciseAssignment.findMany({
    where: { clientId: state.clientId },
    orderBy: { assignedAt: 'desc' },
    select: { exerciseId: true, assignedAt: true, completedAt: true },
  });
  const byExercise = new Map<string, { total: number; completed: number; lastAt: Date }>();
  for (const a of assignments) {
    const existing = byExercise.get(a.exerciseId);
    if (!existing) {
      byExercise.set(a.exerciseId, {
        total: 1,
        completed: a.completedAt ? 1 : 0,
        lastAt: a.assignedAt,
      });
    } else {
      existing.total += 1;
      if (a.completedAt) existing.completed += 1;
    }
  }
  const adherence = new Map<string, AdherenceStat>();
  for (const [exerciseId, agg] of byExercise) {
    adherence.set(exerciseId, {
      exerciseId,
      lastPrescribedAt: agg.lastAt,
      completionRate: agg.total === 0 ? 0 : agg.completed / agg.total,
    });
  }

  const engineInput = {
    currentPhase: state.currentPhase,
    recentRiskSeverity,
    adherence,
  };
  const recommendations =
    state.modality === 'CBT'
      ? recommendCbtExercises(engineInput)
      : recommendEmdrExercises(engineInput);

  return NextResponse.json({
    workflowId: state.id,
    currentPhase: state.currentPhase,
    modality: state.modality,
    recommendations,
  });
}

function pickHighestSeverity(severities: string[]): RiskSeverity {
  const order: RiskSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];
  let max: RiskSeverity = 'none';
  for (const s of severities) {
    // Prisma NoteRiskSeverity enum maps 1:1 with RiskSeverity (lowercase).
    const norm = s.toLowerCase() as RiskSeverity;
    if (order.indexOf(norm) > order.indexOf(max)) max = norm;
  }
  return max;
}
