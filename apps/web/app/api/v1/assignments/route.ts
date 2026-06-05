import { NextResponse, type NextRequest } from 'next/server';
import { CreateExerciseAssignmentInputSchema } from '@cureocity/contracts';
import { getExerciseById } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/assignments — therapist assigns a catalog exercise to
 * one of their clients. Validates the exerciseId against the unified
 * catalog from @cureocity/clinical so we never persist an unknown
 * exercise key. Status starts as PENDING; transitions are recorded
 * either by the client-web PWA (Sprint 8) or by the therapist via
 * PATCH /assignments/[id].
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CreateExerciseAssignmentInputSchema);
  if (!body.ok) return body.response;

  try {
    getExerciseById(body.value.exerciseId);
  } catch {
    return NextResponse.json(
      { error: `Unknown exercise id '${body.value.exerciseId}'. Must be a catalog entry.` },
      { status: 400 },
    );
  }

  // Ownership check on the client.
  const client = await prisma.client.findUnique({
    where: { id: body.value.clientId },
    select: { id: true, psychologistId: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.exerciseAssignment.create({
      data: {
        clientId: body.value.clientId,
        psychologistId: auth.value.psychologistId,
        exerciseId: body.value.exerciseId,
        ...(body.value.dueAt && { dueAt: new Date(body.value.dueAt) }),
        ...(body.value.therapistNote !== undefined && {
          therapistNote: body.value.therapistNote,
        }),
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
          clientId: body.value.clientId,
          exerciseId: body.value.exerciseId,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toExerciseAssignment(created), { status: 201 });
}
