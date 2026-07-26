import { NextResponse, type NextRequest } from 'next/server';
import { SetAvailabilityInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Marketing V1 — the therapist's weekly bookable windows.
 * PUT replaces the whole set atomically (the editor edits the week as
 * one document; per-row PATCH would invite partial saves).
 * Existing REQUESTED/CONFIRMED appointments are untouched — shrinking
 * availability never cancels a held slot.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const rules = await prisma.availabilityRule.findMany({
    where: { psychologistId: auth.value.psychologistId },
    select: { weekday: true, startMinute: true, endMinute: true, slotMinutes: true },
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
  });
  return NextResponse.json({ rules });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, SetAvailabilityInputSchema);
  if (!body.ok) return body.response;

  await prisma.$transaction(async (tx) => {
    await tx.availabilityRule.deleteMany({
      where: { psychologistId: auth.value.psychologistId },
    });
    if (body.value.rules.length > 0) {
      await tx.availabilityRule.createMany({
        data: body.value.rules.map((r) => ({
          psychologistId: auth.value.psychologistId,
          ...r,
        })),
      });
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'AVAILABILITY_UPDATED',
        targetType: 'Psychologist',
        targetId: auth.value.psychologistId,
        metadata: { ruleCount: body.value.rules.length },
      },
      tx,
    );
  });
  return NextResponse.json({ rules: body.value.rules });
}
