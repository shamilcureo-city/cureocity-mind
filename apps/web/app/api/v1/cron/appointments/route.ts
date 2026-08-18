import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import {
  prepareAppointmentReminderEmail,
  sendAppointmentClosedEmail,
} from '@/lib/appointment-email';
import {
  ConditionalAppointmentTransitionError,
  conditionalAppointmentTransition,
} from '@/lib/appointment-transition';
import {
  beginAppointmentReminderSubmission,
  claimAppointmentReminderDelivery,
  completeAppointmentReminderDelivery,
  enqueueDueAppointmentReminderDeliveries,
  failAppointmentReminderBeforeSubmission,
  markAppointmentReminderSubmissionUnknown,
  type ReminderWindowKind,
  windowHours,
} from '@/lib/appointment-reminder-outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/appointments — MK4 housekeeping, one cron, two jobs:
 *
 * 1. EXPIRE: REQUESTED holds older than HOLD_HOURS (48h) release their
 *    slot. A ghosted request must not block a bookable time forever.
 * 2. REMIND: confirmed appointments starting within 24h / 2h get separate
 *    practitioner/patient recipient rows. Provider submission is at-most-once:
 *    a crash may miss, and ambiguous outcomes require manual reconciliation.
 *    Compatibility stamps are set only after all required rows are DELIVERED.
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

  // 2 — enqueue mutually exclusive reminder windows in the durable outbox.
  const twoHourEnd = new Date(now.getTime() + 2 * 60 * 60_000);
  const twentyFourHourEnd = new Date(now.getTime() + 24 * 60 * 60_000);
  const reminderWindows: Array<{
    kind: 'H24' | 'H2';
    reminderKind: ReminderWindowKind;
    startAt: { gt: Date; lte: Date };
  }> = [
    { kind: 'H24', reminderKind: '24H', startAt: { gt: twoHourEnd, lte: twentyFourHourEnd } },
    { kind: 'H2', reminderKind: '2H', startAt: { gt: now, lte: twoHourEnd } },
  ];
  let queued = 0;
  for (const { kind, reminderKind, startAt } of reminderWindows) {
    queued += await enqueueDueAppointmentReminderDeliveries(prisma, {
      kind,
      reminderKind,
      startAt,
      take: 200,
    });
  }

  // 3 — claim one recipient row at a time. DISPATCHING leases may be
  // reclaimed only before submission begins; SUBMISSION_STARTED and UNKNOWN
  // are terminal for automatic workers (at-most-once; crash may miss;
  // manual reconciliation required).
  const candidates = await prisma.appointmentReminderDelivery.findMany({
    where: {
      AND: [
        {
          OR: [
            { status: 'PENDING', leaseExpiresAt: null },
            { status: { in: ['FAILED', 'DISPATCHING'] }, leaseExpiresAt: { lte: now } },
          ],
        },
        {
          OR: [
            { kind: 'H24', appointment: { startAt: { gt: twoHourEnd, lte: twentyFourHourEnd } } },
            { kind: 'H2', appointment: { startAt: { gt: now, lte: twoHourEnd } } },
          ],
        },
      ],
      appointment: { status: 'CONFIRMED' },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  let reminded = 0;
  let manualReview = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.$transaction((tx) =>
      claimAppointmentReminderDelivery(tx, {
        deliveryId: candidate.id,
        now,
        leaseMs: 5 * 60_000,
      }),
    );
    if (!claimed) continue;

    let prepared;
    try {
      prepared = await prepareAppointmentReminderEmail({
        appointment: claimed.appointment,
        recipient: claimed.recipient,
        windowHours: windowHours(claimed.kind),
      });
    } catch {
      prepared = {
        outcome: 'pre_dispatch_failure',
        errorCode: 'REMINDER_PREPARATION_EXCEPTION',
      } as const;
    }

    if (prepared.outcome === 'pre_dispatch_failure') {
      await prisma.$transaction(async (tx) => {
        await failAppointmentReminderBeforeSubmission(
          tx,
          claimed,
          { code: prepared.errorCode },
          new Date(),
        );
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'NOTIFICATION_DISPATCHED',
            targetType: 'Appointment',
            targetId: claimed.appointmentId,
            metadata: {
              psychologistId: claimed.appointment.psychologistId,
              windowHours: windowHours(claimed.kind),
              recipient: claimed.recipient,
              deliveryStatus: 'FAILED',
              errorCode: prepared.errorCode,
              submissionStarted: false,
            },
          },
          tx,
        );
      });
      continue;
    }

    // Commit the irreversible boundary before invoking the closure that can
    // issue the one and only SendGrid request for this recipient row.
    const submitted = await prisma.$transaction((tx) =>
      beginAppointmentReminderSubmission(tx, claimed, new Date()),
    );
    if (!submitted) continue;

    let result;
    try {
      result = await prepared.submit();
    } catch {
      result = { outcome: 'transient_failure', errorCode: 'REMINDER_DISPATCH_EXCEPTION' } as const;
    }

    if (result.outcome === 'sent') {
      const completed = await prisma.$transaction(async (tx) => {
        const won = await completeAppointmentReminderDelivery(tx, submitted, new Date());
        if (!won) return false;
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'APPOINTMENT_REMINDER_SENT',
            targetType: 'Appointment',
            targetId: claimed.appointmentId,
            metadata: {
              psychologistId: claimed.appointment.psychologistId,
              windowHours: windowHours(claimed.kind),
              recipient: claimed.recipient,
              deliverySemantics: 'AT_MOST_ONCE',
            },
          },
          tx,
        );
        return true;
      });
      if (completed) reminded++;
      continue;
    }

    const markedUnknown = await prisma.$transaction(async (tx) => {
      const won = await markAppointmentReminderSubmissionUnknown(tx, submitted, {
        code: result.errorCode ?? 'REMINDER_PROVIDER_ERROR',
      });
      if (!won) return false;
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_DISPATCHED',
          targetType: 'Appointment',
          targetId: claimed.appointmentId,
          metadata: {
            psychologistId: claimed.appointment.psychologistId,
            windowHours: windowHours(claimed.kind),
            recipient: claimed.recipient,
            deliveryStatus: 'UNKNOWN',
            errorCode: result.errorCode ?? 'REMINDER_PROVIDER_ERROR',
            manualReconciliationRequired: true,
          },
        },
        tx,
      );
      return true;
    });
    if (markedUnknown) manualReview++;
  }

  return NextResponse.json({ expired, queued, reminded, manualReview });
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
