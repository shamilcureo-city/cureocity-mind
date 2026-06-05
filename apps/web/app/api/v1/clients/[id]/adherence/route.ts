import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdherenceRollup {
  clientId: string;
  totalAssigned: number;
  totalCompleted: number;
  totalSkipped: number;
  totalPending: number;
  completionRate: number;
  // Last 30-day completion rate (assignments assignedAt within window).
  last30dCompletionRate: number | null;
  last30dAssigned: number;
  // Per-exercise rollup, newest assignment first.
  byExercise: Array<{
    exerciseId: string;
    assigned: number;
    completed: number;
    lastAssignedAt: string;
  }>;
}

/**
 * GET /api/v1/clients/[id]/adherence — therapist-side rollup of
 * ExerciseAssignment outcomes. Returns total + last-30-day completion
 * rates and a per-exercise breakdown so the workflow card can show a
 * single "adherence" gauge without each component running its own
 * aggregation.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const all = await prisma.exerciseAssignment.findMany({
    where: { clientId },
    select: {
      exerciseId: true,
      assignedAt: true,
      status: true,
    },
    orderBy: { assignedAt: 'desc' },
  });

  const totalAssigned = all.length;
  const totalCompleted = all.filter((a) => a.status === 'COMPLETED').length;
  const totalSkipped = all.filter((a) => a.status === 'SKIPPED').length;
  const totalPending = all.filter(
    (a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS',
  ).length;
  const completionRate = totalAssigned === 0 ? 0 : totalCompleted / totalAssigned;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const last30 = all.filter((a) => a.assignedAt >= thirtyDaysAgo);
  const last30Completed = last30.filter((a) => a.status === 'COMPLETED').length;
  const last30dCompletionRate = last30.length === 0 ? null : last30Completed / last30.length;

  const byExerciseMap = new Map<
    string,
    { assigned: number; completed: number; lastAssignedAt: Date }
  >();
  for (const a of all) {
    const existing = byExerciseMap.get(a.exerciseId);
    if (!existing) {
      byExerciseMap.set(a.exerciseId, {
        assigned: 1,
        completed: a.status === 'COMPLETED' ? 1 : 0,
        lastAssignedAt: a.assignedAt,
      });
    } else {
      existing.assigned += 1;
      if (a.status === 'COMPLETED') existing.completed += 1;
    }
  }
  const byExercise = Array.from(byExerciseMap.entries())
    .map(([exerciseId, agg]) => ({
      exerciseId,
      assigned: agg.assigned,
      completed: agg.completed,
      lastAssignedAt: agg.lastAssignedAt.toISOString(),
    }))
    .sort((a, b) => (a.lastAssignedAt < b.lastAssignedAt ? 1 : -1));

  const response: AdherenceRollup = {
    clientId,
    totalAssigned,
    totalCompleted,
    totalSkipped,
    totalPending,
    completionRate,
    last30dCompletionRate,
    last30dAssigned: last30.length,
    byExercise,
  };
  return NextResponse.json(response);
}
