import { NextResponse, type NextRequest } from 'next/server';
import type { CancelAppointmentResponse } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { verifyAppointmentSig } from '@/lib/appointment-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/public/appointments/[id]/cancel?sig=…
 *
 * PUBLIC, signed — the patient's "can't make it" link. POST-only (a
 * prefetched GET must never cancel anything — the sign-out incident
 * rule). Frees the slot; a session already minted from the appointment
 * is cancelled with it so the therapist's calendar stays true.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get('sig') ?? '';
  if (!verifyAppointmentSig(id, sig)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { status: true, sessionId: true, psychologistId: true, startAt: true },
  });
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (appt.status === 'CANCELLED') {
    const body: CancelAppointmentResponse = { status: 'CANCELLED' };
    return NextResponse.json(body);
  }
  if (appt.status === 'DECLINED') {
    return NextResponse.json({ error: 'This request was already declined.' }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
    if (appt.sessionId) {
      await tx.session.updateMany({
        where: { id: appt.sessionId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      });
    }
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'APPOINTMENT_CANCELLED',
        targetType: 'Appointment',
        targetId: id,
        metadata: {
          psychologistId: appt.psychologistId,
          startAt: appt.startAt.toISOString(),
          sessionId: appt.sessionId,
          via: 'patient-link',
        },
      },
      tx,
    );
  });

  const body: CancelAppointmentResponse = { status: 'CANCELLED' };
  return NextResponse.json(body);
}
