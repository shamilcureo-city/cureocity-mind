import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { sendAppointmentClosedEmail, sendAppointmentReminderEmails } from '@/lib/appointment-email';
import {
  ConditionalAppointmentTransitionError,
  conditionalAppointmentTransition,
} from '@/lib/appointment-transition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/appointments — MK4 housekeeping, one cron, two jobs:
 *
 * 1. EXPIRE: REQUESTED holds older than HOLD_HOURS (48h) release their
 *    slot. A ghosted request must not block a bookable time forever.
 * 2. REMIND: confirmed appointments starting within 24h / 2h get their
 *    reminder (therapist email now; WhatsApp when WATI is procured).
 *    Stamps reminded24At/reminded2At so each window sends exactly once.
 *
 * Same fail-closed CRON_SECRET auth as every other cron.
 */

const HOLD_HOURS = Number(process.env['APPOINTMENT_HOLD_HOURS'] ?? 48);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();

  // 1 — expire stale holds and requests whose slot already started.
  const staleCutoff = new Date(now.getTime() - HOLD_HOURS * 60 * 60_000);
  const expiryCandidates = await prisma.appointment.findMany({
    where: {
      status: 'REQUESTED',
      OR: [{ createdAt: { lt: staleCutoff } }, { startAt: { lt: now } }],
    },
    select: { id: true, psychologistId: true, startAt: true },
    take: 200,
  });
  let expired = 0;
  for (const appt of expiryCandidates) {
    try {
      await prisma.$transaction(async (tx) => {
        await conditionalAppointmentTransition(tx, {
          appointmentId: appt.id,
          expectedStatus: 'REQUESTED',
          data: { status: 'CANCELLED' },
        });
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'APPOINTMENT_EXPIRED',
            targetType: 'Appointment',
            targetId: appt.id,
            metadata: {
              psychologistId: appt.psychologistId,
              startAt: appt.startAt.toISOString(),
              holdHours: HOLD_HOURS,
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof ConditionalAppointmentTransitionError) continue;
      throw error;
    }
    expired++;
    // MK8 — tell the patient the hold lapsed instead of going silent.
    await sendAppointmentClosedEmail(appt.psychologistId, appt.id, appt.startAt);
  }

  // 2 — reminders.
  let reminded = 0;
  for (const [column, hours] of [
    ['reminded24At', 24],
    ['reminded2At', 2],
  ] as const) {
    const due = await prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        startAt: { gt: now, lt: new Date(now.getTime() + hours * 60 * 60_000) },
        [column]: null,
      },
      select: { id: true, psychologistId: true, startAt: true, patientEmailEncrypted: true },
      take: 200,
    });
    for (const appt of due) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { [column]: now },
      });
      await sendAppointmentReminderEmails(appt.psychologistId, appt.id, appt.startAt, hours);
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'APPOINTMENT_REMINDER_SENT',
        targetType: 'Appointment',
        targetId: appt.id,
        metadata: { psychologistId: appt.psychologistId, windowHours: hours },
      });
      reminded++;
    }
  }

  return NextResponse.json({ expired, reminded });
}

function isAuthorized(req: NextRequest): boolean {
  // Fail closed (AUD1 pattern): CRON_SECRET must be set and presented.
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing all cron invocations (fail closed).');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
