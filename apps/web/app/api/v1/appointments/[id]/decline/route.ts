import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/appointments/[id]/decline — releases the held slot
 * (a DECLINED row no longer counts as busy in the public feed).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { psychologistId: true, status: true },
  });
  if (!appt || appt.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (appt.status !== 'REQUESTED') {
    return NextResponse.json({ error: `Already ${appt.status.toLowerCase()}.` }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id }, data: { status: 'DECLINED' } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'APPOINTMENT_DECLINED',
        targetType: 'Appointment',
        targetId: id,
        metadata: {},
      },
      tx,
    );
  });
  return NextResponse.json({ status: 'DECLINED' });
}
