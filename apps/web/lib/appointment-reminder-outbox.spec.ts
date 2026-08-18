import { describe, expect, it, vi } from 'vitest';
import {
  cancelAppointmentReminderDeliveriesForReschedule,
  enqueueDueAppointmentReminderDeliveries,
  reminderKindForStart,
} from './appointment-reminder-outbox';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const SCHEDULED_START = new Date('2026-08-18T14:00:00.000Z');

describe('reminderKindForStart', () => {
  it('uses mutually exclusive reminder windows', () => {
    expect(reminderKindForStart(NOW, new Date(NOW.getTime() + 24 * 60 * 60_000))).toBe('24H');
    expect(reminderKindForStart(NOW, new Date(NOW.getTime() + 2 * 60 * 60_000 + 1))).toBe('24H');
    expect(reminderKindForStart(NOW, new Date(NOW.getTime() + 2 * 60 * 60_000))).toBe('2H');
    expect(reminderKindForStart(NOW, new Date(NOW.getTime() + 1))).toBe('2H');
    expect(reminderKindForStart(NOW, NOW)).toBeNull();
    expect(reminderKindForStart(NOW, new Date(NOW.getTime() + 24 * 60 * 60_000 + 1))).toBeNull();
  });
});

describe('durable reminder enqueue', () => {
  function inMemoryEnqueueDb(candidateCount: number, existingCount = 0) {
    const startAt = new Date('2026-08-18T13:00:00.000Z');
    const appointments = Array.from({ length: candidateCount }, (_, index) => ({
      id: `appt-${index.toString().padStart(3, '0')}`,
      startAt,
      hasPatientEmail: false,
    }));
    const existing = new Set(
      appointments
        .slice(0, existingCount)
        .map(
          (appointment) =>
            `${appointment.id}:${appointment.startAt.toISOString()}:H2:PRACTITIONER_EMAIL`,
        ),
    );
    const createdBatches: Array<Array<{ appointmentId: string; scheduledStartAt: Date }>> = [];
    const queryRaw = vi.fn(async (_query: unknown) =>
      appointments
        .filter(
          (appointment) =>
            !existing.has(
              `${appointment.id}:${appointment.startAt.toISOString()}:H2:PRACTITIONER_EMAIL`,
            ),
        )
        .slice(0, 200),
    );
    const createMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      let count = 0;
      const created: Array<{ appointmentId: string; scheduledStartAt: Date }> = [];
      for (const row of data) {
        const appointmentId = row['appointmentId'] as string;
        const scheduledStartAt = row['scheduledStartAt'] as Date;
        const key = `${appointmentId}:${scheduledStartAt.toISOString()}:${String(row['kind'])}:${String(row['recipient'])}`;
        if (existing.has(key)) continue;
        existing.add(key);
        created.push({ appointmentId, scheduledStartAt });
        count++;
      }
      createdBatches.push(created);
      return { count };
    });

    return {
      db: { $queryRaw: queryRaw, appointmentReminderDelivery: { createMany } },
      appointments,
      createdBatches,
      existing,
      queryRaw,
    };
  }

  it('excludes exact existing recipient rows so repeated bounded runs progress past 200', async () => {
    const state = inMemoryEnqueueDb(450, 200);
    const input = {
      kind: 'H2' as const,
      reminderKind: '2H' as const,
      startAt: { gt: NOW, lte: new Date('2026-08-18T14:00:00.000Z') },
      take: 200,
    };

    await expect(enqueueDueAppointmentReminderDeliveries(state.db as never, input)).resolves.toBe(
      200,
    );
    await expect(enqueueDueAppointmentReminderDeliveries(state.db as never, input)).resolves.toBe(
      50,
    );
    await expect(enqueueDueAppointmentReminderDeliveries(state.db as never, input)).resolves.toBe(
      0,
    );

    expect(state.existing).toHaveLength(450);
    expect(state.createdBatches[0]?.map(({ appointmentId }) => appointmentId)).toEqual(
      state.appointments.slice(200, 400).map(({ id }) => id),
    );
    const query = state.queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    const sql = query.strings.join(' ');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('d."recipient"');
    expect(sql).toContain('ORDER BY a."startAt" ASC, a."id" ASC');
  });

  it('keeps concurrent enqueue workers unique and idempotent', async () => {
    const state = inMemoryEnqueueDb(250);
    const input = {
      kind: 'H2' as const,
      reminderKind: '2H' as const,
      startAt: { gt: NOW, lte: new Date('2026-08-18T14:00:00.000Z') },
      take: 200,
    };

    const queued = await Promise.all([
      enqueueDueAppointmentReminderDeliveries(state.db as never, input),
      enqueueDueAppointmentReminderDeliveries(state.db as never, input),
    ]);

    expect(queued.reduce((sum, count) => sum + count, 0)).toBe(200);
    expect(state.existing).toHaveLength(200);
  });
});

describe('reschedule invalidation', () => {
  it('cancels only recipient rows that have not started submission', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };

    await expect(
      cancelAppointmentReminderDeliveriesForReschedule(tx as never, {
        appointmentId: 'appt-1',
        scheduledStartAt: SCHEDULED_START,
      }),
    ).resolves.toBe(2);
    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        appointmentId: 'appt-1',
        scheduledStartAt: SCHEDULED_START,
        status: { in: ['PENDING', 'FAILED', 'DISPATCHING'] },
      },
      data: { status: 'CANCELLED', leaseExpiresAt: null, lastError: null },
    });
  });
});
