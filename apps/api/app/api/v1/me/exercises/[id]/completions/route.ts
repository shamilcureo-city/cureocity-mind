import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { RecordCompletionInputSchema } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/me/exercises/:id/completions — patient completes the
 * exercise. Transitions PENDING/IN_PROGRESS → COMPLETED, records the
 * structured response + optional notes, writes audit.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const dto = await parseJson(req, RecordCompletionInputSchema);
  if (!dto.ok) return dto.response;

  const existing = await prisma.exerciseAssignment.findUnique({ where: { id } });
  if (!existing || existing.clientId !== auth.value.clientId) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (existing.status === 'COMPLETED') {
    return NextResponse.json({ error: 'Assignment already completed' }, { status: 409 });
  }
  if (existing.status === 'SKIPPED' || existing.status === 'EXPIRED') {
    return NextResponse.json(
      { error: `Cannot complete an assignment in ${existing.status} state` },
      { status: 400 },
    );
  }

  const responseWithNotes: Record<string, unknown> = { ...dto.value.response };
  if (dto.value.notes !== undefined) responseWithNotes['notes'] = dto.value.notes;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.exerciseAssignment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        response: responseWithNotes as Prisma.InputJsonValue,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'EXERCISE_COMPLETION_RECORDED',
        targetType: 'ExerciseAssignment',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: auth.value.clientId,
          exerciseId: existing.exerciseId,
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toExerciseAssignment(updated), { status: 200 });
}
