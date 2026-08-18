import { NextResponse, type NextRequest } from 'next/server';
import type { CancelAppointmentResponse } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { verifyAppointmentSig } from '@/lib/appointment-links';
import {
  appointmentConcurrentModificationResponse,
  conditionalAppointmentTransition,
} from '@/lib/appointment-transition';
import {
  conditionalSessionTransition,
  sessionConcurrentModificationResponse,
} from '@/lib/session-transition';

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
    select: { status: true, psychologistId: true, startAt: true },
  });
  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (appt.status === 'CANCELLED') {
    const body: CancelAppointmentResponse = { status: 'CANCELLED' };
    return NextResponse.json(body);
  }
  if (appt.status === 'DECLINED') {
    return NextResponse.json({ error: 'This request was already declined.' }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const cancelled = await conditionalAppointmentTransition(tx, {
        appointmentId: id,
        expectedStatus: appt.status,
        data: { status: 'CANCELLED' },
      });
      if (cancelled.sessionId) {
        await conditionalSessionTransition(tx, {
          sessionId: cancelled.sessionId,
          expectedStatus: 'SCHEDULED',
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
            sessionId: cancelled.sessionId,
            via: 'patient-link',
          },
        },
        tx,
      );
    });
  } catch (error) {
    const response =
      appointmentConcurrentModificationResponse(error) ??
      sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }

  const body: CancelAppointmentResponse = { status: 'CANCELLED' };
  return NextResponse.json(body);
}
