import { describe, expect, it, vi } from 'vitest';
import {
  appointmentConcurrentModificationResponse,
  claimAppointmentReminder,
  conditionalAppointmentTransition,
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

describe('claimAppointmentReminder', () => {
  it('claims only a confirmed appointment whose selected reminder marker is null', async () => {
    const tx = transaction(1);

    await expect(
      claimAppointmentReminder(tx as never, {
        appointmentId: 'appt-1',
        column: 'reminded24At',
        claimedAt: new Date('2026-08-18T12:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    expect(tx.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt-1', status: 'CONFIRMED', reminded24At: null },
      data: { reminded24At: new Date('2026-08-18T12:00:00.000Z') },
    });
  });

  it('allows exactly one parallel invocation to claim a reminder', async () => {
    let unclaimed = true;
    const tx = {
      appointment: {
        updateMany: vi.fn().mockImplementation(async () => {
          if (!unclaimed) return { count: 0 };
          unclaimed = false;
          return { count: 1 };
        }),
      },
    };

    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimAppointmentReminder(tx as never, {
          appointmentId: 'appt-1',
          column: 'reminded2At',
          claimedAt: new Date('2026-08-18T12:00:00.000Z'),
        }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(tx.appointment.updateMany).toHaveBeenCalledTimes(20);
  });

  it('does not claim when the conditional update count is zero', async () => {
    const tx = transaction(0);

    await expect(
      claimAppointmentReminder(tx as never, {
        appointmentId: 'appt-1',
        column: 'reminded2At',
        claimedAt: new Date('2026-08-18T12:00:00.000Z'),
      }),
    ).resolves.toBe(false);
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
