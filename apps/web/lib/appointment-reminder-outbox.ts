import { Prisma, type AppointmentReminderDelivery } from '@prisma/client';

export type ReminderWindowKind = '24H' | '2H';

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function reminderKindForStart(now: Date, startAt: Date): ReminderWindowKind | null {
  const untilStart = startAt.getTime() - now.getTime();
  if (untilStart <= 0 || untilStart > TWENTY_FOUR_HOURS_MS) return null;
  return untilStart <= TWO_HOURS_MS ? '2H' : '24H';
}

export function providerIdempotencyKey(appointmentId: string, kind: ReminderWindowKind): string {
  return `appointment-reminder:${appointmentId}:${kind}`;
}

export function prismaReminderKind(kind: ReminderWindowKind): 'H24' | 'H2' {
  return kind === '24H' ? 'H24' : 'H2';
}

export function windowHours(kind: AppointmentReminderDelivery['kind']): 24 | 2 {
  return kind === 'H24' ? 24 : 2;
}

/**
 * Conditional update is the outbox lock. PENDING can be claimed once; FAILED
 * and abandoned IN_FLIGHT rows become claimable only when their lease expires.
 */
export async function claimAppointmentReminderDelivery(
  tx: Prisma.TransactionClient,
  input: { deliveryId: string; now: Date; leaseMs: number },
): Promise<AppointmentReminderDelivery | null> {
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
  const result = await tx.appointmentReminderDelivery.updateMany({
    where: {
      id: input.deliveryId,
      appointment: { status: 'CONFIRMED', startAt: { gt: input.now } },
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
  return tx.appointmentReminderDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } });
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
