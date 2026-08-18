import { Prisma, type Appointment, type AppointmentReminderDelivery } from '@prisma/client';

export type ReminderWindowKind = '24H' | '2H';

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function reminderKindForStart(now: Date, startAt: Date): ReminderWindowKind | null {
  const untilStart = startAt.getTime() - now.getTime();
  if (untilStart <= 0 || untilStart > TWENTY_FOUR_HOURS_MS) return null;
  return untilStart <= TWO_HOURS_MS ? '2H' : '24H';
}

export function prismaReminderKind(kind: ReminderWindowKind): 'H24' | 'H2' {
  return kind === '24H' ? 'H24' : 'H2';
}

export function windowHours(kind: AppointmentReminderDelivery['kind']): 24 | 2 {
  return kind === 'H24' ? 24 : 2;
}

interface ReminderEnqueueDatabase {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  appointmentReminderDelivery: Pick<
    Prisma.TransactionClient['appointmentReminderDelivery'],
    'createMany'
  >;
}

/**
 * Enqueue one bounded appointment batch, creating a PHI-free row for each
 * required recipient. The anti-join checks each recipient so a partial prior
 * insert cannot starve the missing row behind the 200-appointment page.
 */
export async function enqueueDueAppointmentReminderDeliveries(
  db: ReminderEnqueueDatabase,
  input: {
    kind: 'H24' | 'H2';
    reminderKind: ReminderWindowKind;
    startAt: { gt: Date; lte: Date };
    take: number;
  },
): Promise<number> {
  const appointments = await db.$queryRaw<
    Array<{ id: string; startAt: Date; hasPatientEmail: boolean }>
  >(Prisma.sql`
    SELECT a."id", a."startAt", (a."patientEmailEncrypted" IS NOT NULL) AS "hasPatientEmail"
    FROM "Appointment" a
    WHERE a."status" = 'CONFIRMED'::"AppointmentStatus"
      AND a."startAt" > ${input.startAt.gt}
      AND a."startAt" <= ${input.startAt.lte}
      AND (
        NOT EXISTS (
          SELECT 1 FROM "appointment_reminder_deliveries" d
          WHERE d."appointmentId" = a."id"
            AND d."scheduledStartAt" = a."startAt"
            AND d."kind" = ${input.reminderKind}::"AppointmentReminderKind"
            AND d."recipient" = 'PRACTITIONER_EMAIL'::"AppointmentReminderRecipient"
        )
        OR (
          a."patientEmailEncrypted" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "appointment_reminder_deliveries" d
            WHERE d."appointmentId" = a."id"
              AND d."scheduledStartAt" = a."startAt"
              AND d."kind" = ${input.reminderKind}::"AppointmentReminderKind"
              AND d."recipient" = 'PATIENT_EMAIL'::"AppointmentReminderRecipient"
          )
        )
      )
    ORDER BY a."startAt" ASC, a."id" ASC
    LIMIT ${input.take}
  `);
  if (appointments.length === 0) return 0;

  const data = appointments.flatMap((appointment) => [
    {
      appointmentId: appointment.id,
      scheduledStartAt: appointment.startAt,
      kind: input.kind,
      recipient: 'PRACTITIONER_EMAIL' as const,
    },
    ...(appointment.hasPatientEmail
      ? [
          {
            appointmentId: appointment.id,
            scheduledStartAt: appointment.startAt,
            kind: input.kind,
            recipient: 'PATIENT_EMAIL' as const,
          },
        ]
      : []),
  ]);
  const result = await db.appointmentReminderDelivery.createMany({ data, skipDuplicates: true });
  return result.count;
}

/** Preserve terminal history while cancelling only rows that have not submitted. */
export async function cancelAppointmentReminderDeliveriesForReschedule(
  tx: Prisma.TransactionClient,
  input: { appointmentId: string; scheduledStartAt: Date },
): Promise<number> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      appointmentId: input.appointmentId,
      scheduledStartAt: input.scheduledStartAt,
      status: { in: ['PENDING', 'FAILED', 'DISPATCHING'] },
    },
    data: { status: 'CANCELLED', leaseExpiresAt: null, lastError: null },
  });
  return result.count;
}

function claimable(
  delivery: Pick<AppointmentReminderDelivery, 'status' | 'leaseExpiresAt'>,
  now: Date,
): boolean {
  if (delivery.status === 'PENDING') return delivery.leaseExpiresAt === null;
  return (
    (delivery.status === 'FAILED' || delivery.status === 'DISPATCHING') &&
    delivery.leaseExpiresAt !== null &&
    delivery.leaseExpiresAt <= now
  );
}

/**
 * Lock Appointment before its recipient row, then re-read the exact schedule,
 * window, status, and recipient availability. DISPATCHING is a retryable lease:
 * no provider call is allowed until a second transaction irreversibly records
 * SUBMISSION_STARTED.
 */
export async function claimAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; now: Date; leaseMs: number },
): Promise<(AppointmentReminderDelivery & { appointment: Appointment }) | null> {
  const delivery = await tx.appointmentReminderDelivery.findUnique({
    where: { id: input.deliveryId },
    select: {
      appointmentId: true,
      scheduledStartAt: true,
      kind: true,
      recipient: true,
      status: true,
      leaseExpiresAt: true,
    },
  });
  if (!delivery || !claimable(delivery, input.now)) return null;

  const appointments = await tx.$queryRaw<Appointment[]>(Prisma.sql`
    SELECT a.* FROM "Appointment" a
    WHERE a."id" = ${delivery.appointmentId}
    FOR UPDATE
  `);
  const appointment = appointments[0];
  if (!appointment) return null;
  const expectedKind = reminderKindForStart(input.now, appointment.startAt);
  if (
    appointment.status !== 'CONFIRMED' ||
    appointment.startAt.getTime() !== delivery.scheduledStartAt.getTime() ||
    expectedKind === null ||
    prismaReminderKind(expectedKind) !== delivery.kind ||
    (delivery.recipient === 'PATIENT_EMAIL' && !appointment.patientEmailEncrypted)
  ) {
    return null;
  }

  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: input.deliveryId,
      scheduledStartAt: appointment.startAt,
      OR: [
        { status: 'PENDING', leaseExpiresAt: null },
        {
          status: { in: ['FAILED', 'DISPATCHING'] },
          leaseExpiresAt: { lte: input.now },
        },
      ],
    },
    data: {
      status: 'DISPATCHING',
      attemptCount: { increment: 1 },
      leaseExpiresAt,
      lastError: null,
    },
  });
  if (result.count !== 1) return null;
  return tx.appointmentReminderDelivery.findUniqueOrThrow({
    where: { id: input.deliveryId },
    include: { appointment: true },
  });
}

/**
 * Irreversible automatic-worker boundary. Commit this transition before the
 * first network byte can be sent. A crash afterwards may miss the reminder;
 * automatic retry is forbidden and manual reconciliation is required.
 */
export async function beginAppointmentReminderSubmission(
  tx: Prisma.TransactionClient,
  delivery: Pick<AppointmentReminderDelivery, 'id' | 'leaseExpiresAt'>,
  startedAt: Date,
): Promise<AppointmentReminderDelivery | null> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: { id: delivery.id, status: 'DISPATCHING', leaseExpiresAt: delivery.leaseExpiresAt },
    data: { status: 'SUBMISSION_STARTED', submissionStartedAt: startedAt, leaseExpiresAt: null },
  });
  if (result.count !== 1) return null;
  return tx.appointmentReminderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
}

/** Mark one accepted recipient and stamp compatibility only when all are delivered. */
export async function completeAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  delivery: Pick<
    AppointmentReminderDelivery,
    'id' | 'appointmentId' | 'scheduledStartAt' | 'kind' | 'submissionStartedAt'
  >,
  deliveredAt: Date,
): Promise<boolean> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: 'SUBMISSION_STARTED',
      submissionStartedAt: delivery.submissionStartedAt,
    },
    data: {
      status: 'DELIVERED',
      deliveredAt,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  if (result.count !== 1) return false;

  const incompleteRecipients = await tx.appointmentReminderDelivery.count({
    where: {
      appointmentId: delivery.appointmentId,
      scheduledStartAt: delivery.scheduledStartAt,
      kind: delivery.kind,
      status: { not: 'DELIVERED' },
    },
  });
  if (incompleteRecipients === 0) {
    await tx.appointment.updateMany({
      where: {
        id: delivery.appointmentId,
        status: 'CONFIRMED',
        startAt: delivery.scheduledStartAt,
      },
      data: { [delivery.kind === 'H24' ? 'reminded24At' : 'reminded2At']: deliveredAt },
    });
  }
  return true;
}

export interface ReminderFailure {
  code: string;
  /** Deliberately ignored: provider details can contain patient PHI. */
  detail?: string;
}

function compactNonPhiError(code: string): string {
  const compact = code
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 128);
  return compact || 'REMINDER_DELIVERY_ERROR';
}

/** A local/config/preparation failure is retryable only before submission starts. */
export async function failAppointmentReminderBeforeSubmission(
  tx: Prisma.TransactionClient,
  delivery: Pick<AppointmentReminderDelivery, 'id' | 'attemptCount' | 'leaseExpiresAt'>,
  failure: ReminderFailure,
  now: Date,
): Promise<boolean> {
  const delayMs = Math.min(2 ** Math.max(delivery.attemptCount - 1, 0) * 60_000, MAX_BACKOFF_MS);
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: { id: delivery.id, status: 'DISPATCHING', leaseExpiresAt: delivery.leaseExpiresAt },
    data: {
      status: 'FAILED',
      leaseExpiresAt: new Date(now.getTime() + delayMs),
      lastError: compactNonPhiError(failure.code),
    },
  });
  return result.count === 1;
}

/** Provider acceptance is unknowable after submission begins; never auto-retry. */
export async function markAppointmentReminderSubmissionUnknown(
  tx: Prisma.TransactionClient,
  delivery: Pick<AppointmentReminderDelivery, 'id' | 'submissionStartedAt'>,
  failure: ReminderFailure,
): Promise<boolean> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: 'SUBMISSION_STARTED',
      submissionStartedAt: delivery.submissionStartedAt,
    },
    data: {
      status: 'UNKNOWN',
      leaseExpiresAt: null,
      lastError: compactNonPhiError(failure.code),
    },
  });
  return result.count === 1;
}
