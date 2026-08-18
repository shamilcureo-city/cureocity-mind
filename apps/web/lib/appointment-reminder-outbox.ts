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

export function providerIdempotencyKey(
  appointmentId: string,
  scheduledStartAt: Date,
  kind: ReminderWindowKind,
): string {
  return `appointment-reminder:${appointmentId}:${scheduledStartAt.getTime()}:${kind}`;
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

/** Enqueue one bounded batch while excluding exact deliveries already present. */
export async function enqueueDueAppointmentReminderDeliveries(
  db: ReminderEnqueueDatabase,
  input: {
    kind: 'H24' | 'H2';
    reminderKind: ReminderWindowKind;
    startAt: { gt: Date; lte: Date };
    take: number;
  },
): Promise<number> {
  const appointments = await db.$queryRaw<Array<{ id: string; startAt: Date }>>(Prisma.sql`
    SELECT a."id", a."startAt"
    FROM "appointments" a
    WHERE a."status" = 'CONFIRMED'::"AppointmentStatus"
      AND a."startAt" > ${input.startAt.gt}
      AND a."startAt" <= ${input.startAt.lte}
      AND NOT EXISTS (
        SELECT 1
        FROM "appointment_reminder_deliveries" d
        WHERE d."appointmentId" = a."id"
          AND d."scheduledStartAt" = a."startAt"
          AND d."kind" = ${input.reminderKind}::"AppointmentReminderKind"
      )
    ORDER BY a."startAt" ASC, a."id" ASC
    LIMIT ${input.take}
  `);
  if (appointments.length === 0) return 0;

  const result = await db.appointmentReminderDelivery.createMany({
    data: appointments.map((appointment) => ({
      appointmentId: appointment.id,
      scheduledStartAt: appointment.startAt,
      kind: input.kind,
      providerIdempotencyKey: providerIdempotencyKey(
        appointment.id,
        appointment.startAt,
        input.reminderKind,
      ),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Preserve delivered history while making the old schedule undispatchable. */
export async function cancelAppointmentReminderDeliveriesForReschedule(
  tx: Prisma.TransactionClient,
  input: { appointmentId: string; scheduledStartAt: Date },
): Promise<number> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      appointmentId: input.appointmentId,
      scheduledStartAt: input.scheduledStartAt,
      status: { in: ['PENDING', 'FAILED', 'IN_FLIGHT'] },
    },
    data: { status: 'CANCELLED', leaseExpiresAt: null, lastError: null },
  });
  return result.count;
}

/**
 * Locks both the outbox row and its Appointment, then validates the exact
 * schedule snapshot and mutually exclusive window before acquiring the lease.
 * The returned Appointment was reread under that lock and is the only data the
 * caller may use for dispatch.
 */
export async function claimAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; now: Date; leaseMs: number },
): Promise<(AppointmentReminderDelivery & { appointment: Appointment }) | null> {
  const delivery = await tx.appointmentReminderDelivery.findUnique({
    where: { id: input.deliveryId },
    select: { appointmentId: true, scheduledStartAt: true, kind: true },
  });
  if (!delivery) return null;

  // Follow the lifecycle-wide lock order: Appointment before dependent rows.
  // Reschedule takes this same lock before cancelling outbox rows.
  const appointments = await tx.$queryRaw<Appointment[]>(Prisma.sql`
    SELECT a.*
    FROM "appointments" a
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
    prismaReminderKind(expectedKind) !== delivery.kind
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
          status: { in: ['FAILED', 'IN_FLIGHT'] },
          leaseExpiresAt: { lte: input.now },
        },
      ],
    },
    data: {
      status: 'IN_FLIGHT',
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

/** Must run in one transaction so the legacy marker never leads DELIVERED. */
export async function completeAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  delivery: Pick<
    AppointmentReminderDelivery,
    'id' | 'appointmentId' | 'kind' | 'providerIdempotencyKey' | 'leaseExpiresAt'
  >,
  deliveredAt: Date,
): Promise<boolean> {
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: 'IN_FLIGHT',
      providerIdempotencyKey: delivery.providerIdempotencyKey,
      leaseExpiresAt: delivery.leaseExpiresAt,
    },
    data: {
      status: 'DELIVERED',
      deliveredAt,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  if (result.count !== 1) return false;

  await tx.appointment.updateMany({
    where: { id: delivery.appointmentId, status: 'CONFIRMED' },
    data: { [delivery.kind === 'H24' ? 'reminded24At' : 'reminded2At']: deliveredAt },
  });
  return true;
}

export interface ReminderFailure {
  code: string;
  transient: boolean;
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

export async function failAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  delivery: Pick<
    AppointmentReminderDelivery,
    'id' | 'attemptCount' | 'providerIdempotencyKey' | 'leaseExpiresAt'
  >,
  failure: ReminderFailure,
  now: Date,
): Promise<boolean> {
  // 1m, 2m, 4m ... bounded at 1h. attemptCount already includes this try.
  const delayMs = Math.min(2 ** Math.max(delivery.attemptCount - 1, 0) * 60_000, MAX_BACKOFF_MS);
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: delivery.id,
      status: 'IN_FLIGHT',
      providerIdempotencyKey: delivery.providerIdempotencyKey,
      leaseExpiresAt: delivery.leaseExpiresAt,
    },
    data: {
      status: 'FAILED',
      leaseExpiresAt: failure.transient ? new Date(now.getTime() + delayMs) : null,
      lastError: compactNonPhiError(failure.code),
    },
  });
  return result.count === 1;
}
