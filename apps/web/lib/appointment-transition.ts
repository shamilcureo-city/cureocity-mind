import type { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

export class ConditionalAppointmentTransitionError extends Error {
  readonly code = 'APPOINTMENT_CONCURRENT_MODIFICATION' as const;

  constructor() {
    super('The appointment changed while this request was processed');
    this.name = 'ConditionalAppointmentTransitionError';
  }
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
