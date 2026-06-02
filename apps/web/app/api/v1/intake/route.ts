import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toIntake } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateIntakeSchema = z.object({
  patientName: z.string().min(1).max(120),
  patientEmail: z.string().email(),
  patientPhone: z.string().min(6).max(32),
  concerns: z.array(z.string().min(1).max(120)).min(1).max(20),
  notes: z.string().max(4000).optional(),
  preferredModality: z.string().max(60).optional(),
  preferredLanguage: z.string().max(60).optional(),
  mode: z.enum(['IN_PERSON', 'ONLINE', 'EITHER']).default('EITHER'),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});

/** POST /api/v1/intake — public; no auth required. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const input = await parseJson(req, CreateIntakeSchema);
  if (!input.ok) return input.response;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.intakeSubmission.create({
      data: {
        patientName: input.value.patientName,
        patientEmail: input.value.patientEmail,
        patientPhone: input.value.patientPhone,
        concerns: input.value.concerns,
        ...(input.value.notes !== undefined && { notes: input.value.notes }),
        ...(input.value.preferredModality !== undefined && {
          preferredModality: input.value.preferredModality,
        }),
        ...(input.value.preferredLanguage !== undefined && {
          preferredLanguage: input.value.preferredLanguage,
        }),
        mode: input.value.mode,
        urgency: input.value.urgency,
      },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'INTAKE_SUBMITTED',
        targetType: 'IntakeSubmission',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          urgency: input.value.urgency,
          concernsCount: input.value.concerns.length,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json(toIntake(created), { status: 201 });
}

/** GET /api/v1/intake — therapist-scoped (their matches + open queue). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.intakeSubmission.findMany({
    where: {
      OR: [{ assignedTherapistId: auth.value.psychologistId }, { assignedTherapistId: null }],
    },
    orderBy: [{ status: 'asc' }, { urgency: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return NextResponse.json({ intakes: rows.map(toIntake), count: rows.length });
}
