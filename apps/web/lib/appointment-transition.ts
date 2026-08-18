import { Prisma, type Appointment, type AppointmentStatus } from '@prisma/client';
import { NextResponse } from 'next/server';

export class ConditionalAppointmentTransitionError extends Error {
  readonly code = 'APPOINTMENT_CONCURRENT_MODIFICATION' as const;

  constructor() {
    super('The appointment changed while this request was processed');
    this.name = 'ConditionalAppointmentTransitionError';
  }
}

export type AppointmentReminderColumn = 'reminded24At' | 'reminded2At';

/**
 * Atomically claim one reminder marker. Concurrent cron invocations can select
 * the same candidate, but only the update whose expected marker is still null
 * returns true and is allowed to dispatch.
 */
export async function claimAppointmentReminder(
  tx: Prisma.TransactionClient,
  input: {
    appointmentId: string;
    column: AppointmentReminderColumn;
    claimedAt: Date;
  },
): Promise<boolean> {
  const result = await tx.appointment.updateMany({
    where: {
      id: input.appointmentId,
      status: 'CONFIRMED',
      [input.column]: null,
    },
    data: { [input.column]: input.claimedAt },
  });
  return result.count === 1;
}

/**
 * Atomically claim an appointment lifecycle edge and return the row as it
 * exists inside the same transaction. A zero count means another transition
 * committed first; throwing ensures all later transaction side effects roll
 * back together.
 */
export async function conditionalAppointmentTransition(
  tx: Prisma.TransactionClient,
  input: {
    appointmentId: string;
    expectedStatus: AppointmentStatus;
    data: Prisma.AppointmentUpdateManyMutationInput;
  },
): Promise<Appointment> {
  const result = await tx.appointment.updateMany({
    where: { id: input.appointmentId, status: input.expectedStatus },
    data: input.data,
  });
  if (result.count !== 1) throw new ConditionalAppointmentTransitionError();
  return tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
}

/**
 * Lock any appointment linked to a session before that session is mutated.
 * Combined lifecycle writers use one global row-lock order: Appointment,
 * then Session. This matches appointment confirmation/cancellation and keeps
 * session rescheduling from deadlocking with public cancellation.
 */
export async function lockLinkedAppointmentForSession(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; psychologistId: string },
): Promise<Appointment | null> {
  const rows = await tx.$queryRaw<Appointment[]>(Prisma.sql`
    SELECT a.*
    FROM "appointments" a
    WHERE a."sessionId" = ${input.sessionId}
      AND a."psychologistId" = ${input.psychologistId}
      AND a."status" = 'CONFIRMED'::"AppointmentStatus"
    ORDER BY a."id"
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

export function appointmentConcurrentModificationResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ConditionalAppointmentTransitionError)) return null;
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
    },
    { status: 409 },
  );
}
