import { NextResponse, type NextRequest } from 'next/server';
import { CreateExerciseAssignmentInputSchema } from '@cureocity/contracts';
import { CBT_EXERCISE_CATALOG, EMDR_EXERCISE_CATALOG } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN_EXERCISE_IDS = new Set<string>([
  ...CBT_EXERCISE_CATALOG.map((e) => e.id),
  ...EMDR_EXERCISE_CATALOG.map((e) => e.id),
]);

/**
 * POST /api/v1/exercise-assignments — therapist prescribes an exercise.
 * Ported from continuity-service AssignmentsService.assign().
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, CreateExerciseAssignmentInputSchema);
  if (!dto.ok) return dto.response;

  if (!KNOWN_EXERCISE_IDS.has(dto.value.exerciseId)) {
    return NextResponse.json(
      { error: `Unknown exercise id "${dto.value.exerciseId}"` },
      { status: 400 },
    );
  }
  const client = await prisma.client.findUnique({ where: { id: dto.value.clientId } });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.exerciseAssignment.create({
      data: {
        clientId: dto.value.clientId,
        psychologistId: auth.value.psychologistId,
        exerciseId: dto.value.exerciseId,
        dueAt: dto.value.dueAt ? new Date(dto.value.dueAt) : null,
        therapistNote: dto.value.therapistNote ?? null,
        status: 'PENDING',
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'EXERCISE_ASSIGNED',
        targetType: 'ExerciseAssignment',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: dto.value.clientId,
          exerciseId: dto.value.exerciseId,
          dueAt: dto.value.dueAt ?? null,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toExerciseAssignment(created), { status: 201 });
}
