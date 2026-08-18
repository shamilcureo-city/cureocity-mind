import { describe, expect, it, vi } from 'vitest';
import {
  appointmentConcurrentModificationResponse,
  conditionalAppointmentTransition,
  lockAppointmentById,
  lockLinkedAppointmentForSession,
} from './appointment-transition';

function transaction(count: number) {
  return {
    appointment: {
      updateMany: vi.fn().mockResolvedValue({ count }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'appt-1',
        status: 'CANCELLED',
        sessionId: 'session-1',
      }),
    },
  };
}

describe('conditionalAppointmentTransition', () => {
  it('updates only the expected appointment state and re-reads the row in the transaction', async () => {
    const tx = transaction(1);

    const appointment = await conditionalAppointmentTransition(tx as never, {
      appointmentId: 'appt-1',
      expectedStatus: 'CONFIRMED',
      data: { status: 'CANCELLED' },
    });

    expect(tx.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt-1', status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
    });
    expect(tx.appointment.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'appt-1' } });
    expect(appointment.sessionId).toBe('session-1');
  });

  it('throws a stable conflict before the row re-read when a concurrent transition wins', async () => {
    const tx = transaction(0);

    await expect(
      conditionalAppointmentTransition(tx as never, {
        appointmentId: 'appt-1',
        expectedStatus: 'REQUESTED',
        data: { status: 'DECLINED' },
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONCURRENT_MODIFICATION' });
    expect(tx.appointment.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('appointment row locks', () => {
  it('queries the physical Appointment table when locking by id', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'appt-1' }]);

    await expect(lockAppointmentById({ $queryRaw: queryRaw } as never, 'appt-1')).resolves.toEqual({
      id: 'appt-1',
    });

    const query = queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    const sql = query.strings.join('?');
    expect(sql).toContain('FROM "Appointment" a');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).not.toContain('FROM "appointments"');
  });

  it('queries the physical Appointment table when locking by linked session', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'appt-1' }]);

    await lockLinkedAppointmentForSession({ $queryRaw: queryRaw } as never, {
      sessionId: 'session-1',
      psychologistId: 'psy-1',
    });

    const query = queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    const sql = query.strings.join('?');
    expect(sql).toContain('FROM "Appointment" a');
    expect(sql).not.toContain('FROM "appointments"');
  });
});

describe('appointmentConcurrentModificationResponse', () => {
  it('maps a lost race to a stable 409 response', async () => {
    const tx = transaction(0);
    let error: unknown;
    try {
      await conditionalAppointmentTransition(tx as never, {
        appointmentId: 'appt-1',
        expectedStatus: 'REQUESTED',
        data: { status: 'CONFIRMED' },
      });
    } catch (caught) {
      error = caught;
    }

    const response = appointmentConcurrentModificationResponse(error);
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'The appointment changed while this request was processed',
      code: 'APPOINTMENT_CONCURRENT_MODIFICATION',
    });
  });
});
