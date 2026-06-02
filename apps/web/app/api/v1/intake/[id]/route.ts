import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toIntake } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['REVIEWED', 'MATCHED', 'CLOSED']),
  assignToSelf: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const input = await parseJson(req, PatchSchema);
  if (!input.ok) return input.response;

  const intake = await prisma.intakeSubmission.findUnique({ where: { id } });
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  if (
    intake.assignedTherapistId !== null &&
    intake.assignedTherapistId !== auth.value.psychologistId
  ) {
    return NextResponse.json(
      { error: 'Intake is already assigned to another therapist' },
      { status: 403 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.intakeSubmission.update({
      where: { id },
      data: {
        status: input.value.status,
        ...(input.value.status === 'MATCHED' && { matchedAt: new Date() }),
        ...(input.value.assignToSelf && {
          assignedTherapistId: auth.value.psychologistId,
        }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: input.value.status === 'MATCHED' ? 'INTAKE_MATCHED' : 'INTAKE_REVIEWED',
        targetType: 'IntakeSubmission',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          assignedToSelf: input.value.assignToSelf === true,
          newStatus: input.value.status,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toIntake(updated));
}
