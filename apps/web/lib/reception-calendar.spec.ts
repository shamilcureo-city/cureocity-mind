import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertReceptionCalendarAvailable,
  loadReceptionBusyIntervals,
  lockReceptionCalendarIfEnabled,
  ReceptionCalendarConflictError,
  receptionCalendarConflictResponse,
} from './reception-calendar';

const at = (time: string) => new Date(`2026-10-05T${time}:00.000Z`);
const query = { from: at('09:00'), to: at('09:30'), slotMinutes: 30 };
const settings = {
  enabled: true,
  slug: 'test-practice',
  revision: 1,
  config: {
    version: 1,
    enabled: true,
    slug: 'test-practice',
    practiceName: 'Test practice',
    timezone: 'Asia/Dubai',
    mode: 'IN_PERSON',
    slotMinutes: 30,
    hours: [{ weekday: 1, startMinute: 480, endMinute: 1020 }],
    faqs: [],
  },
};

function transaction(
  input: {
    sessions?: Array<{ id: string; scheduledAt: Date }>;
    appointments?: Array<{
      id: string;
      sessionId: string | null;
      status: string;
      startAt: Date;
      endAt: Date;
    }>;
  } = {},
) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    receptionSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
    session: { findMany: vi.fn().mockResolvedValue(input.sessions ?? []) },
    appointment: { findMany: vi.fn().mockResolvedValue(input.appointments ?? []) },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('reception calendar guard', () => {
  it.each(['false', '', undefined])(
    'does not touch the database when the switch is %s',
    async (flag) => {
      vi.stubEnv('RECEPTION_PILOT_ENABLED', flag);
      const unavailableDatabase = new Proxy(
        {},
        {
          get() {
            throw new Error('Database accessed');
          },
        },
      );
      await expect(
        lockReceptionCalendarIfEnabled(unavailableDatabase as never, 'psy-1'),
      ).resolves.toBeNull();
    },
  );

  it('takes the shared practitioner lock before reading opt-in settings', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const tx = transaction();
    await expect(lockReceptionCalendarIfEnabled(tx as never, 'psy-1')).resolves.toEqual({
      slotMinutes: 30,
    });
    expect(tx.$executeRaw.mock.calls[0]?.[1]).toBe('reception-calendar:psy-1');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.receptionSettings.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(tx.receptionSettings.findUnique).toHaveBeenCalledWith({
      where: { psychologistId: 'psy-1' },
    });
  });

  it('preserves existing scheduling when the practitioner has not opted in', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const tx = transaction();
    tx.receptionSettings.findUnique.mockResolvedValue({ ...settings, enabled: false });
    await expect(lockReceptionCalendarIfEnabled(tx as never, 'psy-1')).resolves.toBeNull();
    expect(tx.session.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
  });

  it('fails closed if enabled settings are invalid', async () => {
    vi.stubEnv('RECEPTION_PILOT_ENABLED', 'true');
    const tx = transaction();
    tx.receptionSettings.findUnique.mockResolvedValue({ ...settings, config: {} });
    await expect(lockReceptionCalendarIfEnabled(tx as never, 'psy-1')).rejects.toBeInstanceOf(
      ReceptionCalendarConflictError,
    );
  });
});

describe('transaction-local busy intervals', () => {
  it('rejects a conflicting active hold and returns a safe 409', async () => {
    const tx = transaction({
      appointments: [
        {
          id: 'held',
          sessionId: null,
          status: 'REQUESTED',
          startAt: at('09:10'),
          endAt: at('09:40'),
        },
      ],
    });
    let conflict: unknown;
    try {
      await assertReceptionCalendarAvailable(tx as never, 'psy-1', query);
    } catch (error) {
      conflict = error;
    }
    const response = receptionCalendarConflictResponse(conflict);
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'That time is no longer available. Choose another appointment time.',
      code: 'RECEPTION_CALENDAR_CONFLICT',
    });
    expect(tx.appointment.findMany.mock.calls[0]?.[0].where.psychologistId).toBe('psy-1');
  });

  it('reserves at least 60 minutes for standalone sessions and includes in-progress sessions', async () => {
    const tx = transaction({ sessions: [{ id: 'session-1', scheduledAt: at('08:15') }] });
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', query),
    ).rejects.toBeInstanceOf(ReceptionCalendarConflictError);
    expect(tx.session.findMany).toHaveBeenCalledWith({
      where: {
        psychologistId: 'psy-1',
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        scheduledAt: { lt: at('09:30') },
      },
      select: { id: true, scheduledAt: true },
    });
  });

  it('uses the longer configured duration for a standalone session', async () => {
    const tx = transaction({ sessions: [{ id: 'session-1', scheduledAt: at('08:00') }] });
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', { ...query, slotMinutes: 90 }),
    ).rejects.toBeInstanceOf(ReceptionCalendarConflictError);
  });

  it('uses the linked appointment end for a short booking so the next slot stays free', async () => {
    const tx = transaction({
      sessions: [{ id: 'session-1', scheduledAt: at('08:30') }],
      appointments: [
        {
          id: 'appt-1',
          sessionId: 'session-1',
          status: 'CONFIRMED',
          startAt: at('08:30'),
          endAt: at('09:00'),
        },
      ],
    });
    await expect(loadReceptionBusyIntervals(tx as never, 'psy-1', query)).resolves.toEqual([]);
  });

  it('keeps a long linked session busy even when its start precedes the fallback lookback', async () => {
    const tx = transaction({
      sessions: [{ id: 'session-1', scheduledAt: at('07:00') }],
      appointments: [
        {
          id: 'appt-1',
          sessionId: 'session-1',
          status: 'CONFIRMED',
          startAt: at('07:00'),
          endAt: at('09:15'),
        },
      ],
    });
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', query),
    ).rejects.toBeInstanceOf(ReceptionCalendarConflictError);
  });

  it('excludes an appointment and its linked session when confirming or moving that booking', async () => {
    const tx = transaction({
      sessions: [{ id: 'session-1', scheduledAt: at('09:00') }],
      appointments: [
        {
          id: 'appt-1',
          sessionId: 'session-1',
          status: 'CONFIRMED',
          startAt: at('09:00'),
          endAt: at('09:30'),
        },
      ],
    });
    await expect(
      loadReceptionBusyIntervals(tx as never, 'psy-1', {
        ...query,
        excludeAppointmentId: 'appt-1',
      }),
    ).resolves.toEqual([]);
  });

  it('excludes the linked appointment when a session is being moved', async () => {
    const tx = transaction({
      appointments: [
        {
          id: 'appt-1',
          sessionId: 'session-1',
          status: 'CONFIRMED',
          startAt: at('09:00'),
          endAt: at('09:30'),
        },
      ],
    });
    await expect(
      loadReceptionBusyIntervals(tx as never, 'psy-1', { ...query, excludeSessionId: 'session-1' }),
    ).resolves.toEqual([]);
    expect(tx.session.findMany.mock.calls[0]?.[0].where.id).toEqual({ not: 'session-1' });
  });

  it('allows adjacent bookings and ignores inactive holds', async () => {
    const tx = transaction({
      appointments: [
        {
          id: 'before',
          sessionId: null,
          status: 'CONFIRMED',
          startAt: at('08:30'),
          endAt: at('09:00'),
        },
        {
          id: 'after',
          sessionId: null,
          status: 'REQUESTED',
          startAt: at('09:30'),
          endAt: at('10:00'),
        },
        {
          id: 'cancelled',
          sessionId: null,
          status: 'CANCELLED',
          startAt: at('09:00'),
          endAt: at('09:30'),
        },
      ],
    });
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', query),
    ).resolves.toBeUndefined();
  });

  it('allows immediate OPD queue overlap but still rejects a held appointment', async () => {
    const tx = transaction({ sessions: [{ id: 'queued', scheduledAt: at('09:00') }] });
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', { ...query, appointmentsOnly: true }),
    ).resolves.toBeUndefined();
    expect(tx.session.findMany).not.toHaveBeenCalled();
    tx.appointment.findMany.mockResolvedValue([
      {
        id: 'held',
        sessionId: null,
        status: 'CONFIRMED',
        startAt: at('09:00'),
        endAt: at('09:30'),
      },
    ]);
    await expect(
      assertReceptionCalendarAvailable(tx as never, 'psy-1', { ...query, appointmentsOnly: true }),
    ).rejects.toBeInstanceOf(ReceptionCalendarConflictError);
  });
});
