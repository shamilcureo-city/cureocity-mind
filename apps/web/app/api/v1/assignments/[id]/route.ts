import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ExerciseAssignmentStatusSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/assignments/[id] — therapist-side status change.
 *
 * The completion flow (PENDING/IN_PROGRESS → COMPLETED) is owned by
 * the client-web PWA (Sprint 8) since it carries the structured
 * response payload. This endpoint lets the therapist mark something
 * SKIPPED or EXPIRED from the workflow view — useful for cleaning up
 * stale assignments or recording that an exercise was no longer
 * indicated.
 */
const PatchInputSchema = z.object({
  status: ExerciseAssignmentStatusSchema,
  reason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await parseJson(req, PatchInputSchema);
  if (!body.ok) return body.response;

  const row = await prisma.exerciseAssignment.findUnique({ where: { id } });
  if (!row || row.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  // Therapist can only transition to SKIPPED or EXPIRED — completion
  // is owned by the patient flow.
  if (body.value.status !== 'SKIPPED' && body.value.status !== 'EXPIRED') {
    return NextResponse.json(
      {
        error:
          'Therapist can only mark assignments SKIPPED or EXPIRED. Completion is recorded by the client.',
      },
      { status: 422 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.exerciseAssignment.update({
      where: { id: row.id },
      data: { status: body.value.status },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'EXERCISE_SKIPPED',
        targetType: 'ExerciseAssignment',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: row.clientId,
          exerciseId: row.exerciseId,
          fromStatus: row.status,
          toStatus: body.value.status,
          ...(body.value.reason && { reason: body.value.reason }),
        },
      },
      tx,
    );
    return next;
  });

  return NextResponse.json(toExerciseAssignment(updated));
}
