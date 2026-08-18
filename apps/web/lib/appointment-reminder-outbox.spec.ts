import { describe, expect, it, vi } from 'vitest';
import {
  cancelAppointmentReminderDeliveriesForReschedule,
  claimAppointmentReminderDelivery,
  completeAppointmentReminderDelivery,
  enqueueDueAppointmentReminderDeliveries,
  failAppointmentReminderDelivery,
  providerIdempotencyKey,
  reminderKindForStart,
} from './appointment-reminder-outbox';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const LEASE_END = new Date('2026-08-18T12:05:00.000Z');
const SCHEDULED_START = new Date('2026-08-18T14:00:00.000Z');

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    appointmentId: 'appt-1',
    scheduledStartAt: SCHEDULED_START,
    kind: 'H2' as const,
    status: 'IN_FLIGHT' as const,
    attemptCount: 1,
    leaseExpiresAt: LEASE_END,
    providerIdempotencyKey: 'appointment-reminder:appt-1:1787061600000:2H',
    ...overrides,
  };
}

function lockedSchedule(startAt = SCHEDULED_START) {
  return [
    {
      id: 'appt-1',
      status: 'CONFIRMED',
      startAt,
    },
  ];
}

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

describe('providerIdempotencyKey', () => {
  it('is stable per appointment, scheduled start, and reminder kind', () => {
    expect(providerIdempotencyKey('appt-1', SCHEDULED_START, '24H')).toBe(
      'appointment-reminder:appt-1:1787061600000:24H',
    );
    expect(providerIdempotencyKey('appt-1', SCHEDULED_START, '2H')).toBe(
      'appointment-reminder:appt-1:1787061600000:2H',
    );
  });

  it('creates a new logical delivery key after rescheduling', () => {
    const movedStart = new Date('2026-08-19T14:00:00.000Z');
    expect(providerIdempotencyKey('appt-1', movedStart, '2H')).not.toBe(
      providerIdempotencyKey('appt-1', SCHEDULED_START, '2H'),
    );
  });
});

describe('durable reminder enqueue', () => {
  function inMemoryEnqueueDb(candidateCount: number, existingCount = 0) {
    const startAt = new Date('2026-08-18T13:00:00.000Z');
    const appointments = Array.from({ length: candidateCount }, (_, index) => ({
      id: `appt-${index.toString().padStart(3, '0')}`,
      startAt,
    }));
    const existing = new Set(
      appointments
        .slice(0, existingCount)
        .map((appointment) => `${appointment.id}:${appointment.startAt.toISOString()}:H2`),
    );
    const createdBatches: Array<Array<{ appointmentId: string; scheduledStartAt: Date }>> = [];
    const queryRaw = vi.fn(async (_query: unknown) =>
      appointments
        .filter(
          (appointment) =>
            !existing.has(`${appointment.id}:${appointment.startAt.toISOString()}:H2`),
        )
        .slice(0, 200),
    );
    const createMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
      let count = 0;
      const created: Array<{ appointmentId: string; scheduledStartAt: Date }> = [];
      for (const row of data) {
        const appointmentId = row['appointmentId'] as string;
        const scheduledStartAt = row['scheduledStartAt'] as Date;
        const kind = row['kind'] as string;
        const key = `${appointmentId}:${scheduledStartAt.toISOString()}:${kind}`;
        if (existing.has(key)) continue;
        existing.add(key);
        created.push({ appointmentId, scheduledStartAt });
        count++;
      }
      createdBatches.push(created);
      return { count };
    });

    return {
      db: {
        $queryRaw: queryRaw,
        appointmentReminderDelivery: { createMany },
      },
      appointments,
      createdBatches,
      existing,
      queryRaw,
    };
  }

  it('excludes exact existing schedule deliveries so repeated bounded runs progress past 200', async () => {
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
    expect(sql).toContain('d."scheduledStartAt" = a."startAt"');
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
    expect(
      new Set(state.createdBatches.flat().map(({ appointmentId }) => appointmentId)),
    ).toHaveLength(200);
  });
});

describe('reschedule invalidation', () => {
  it('cancels only undelivered rows for the old scheduled start', async () => {
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
        status: { in: ['PENDING', 'FAILED', 'IN_FLIGHT'] },
      },
      data: { status: 'CANCELLED', leaseExpiresAt: null, lastError: null },
    });
  });
});

describe('claimAppointmentReminderDelivery', () => {
  it('allows exactly one of twenty concurrent workers to claim', async () => {
    let available = true;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(lockedSchedule()),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery({ status: 'PENDING' })),
        updateMany: vi.fn(async () => {
          if (!available) return { count: 0 };
          available = false;
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => delivery()),
      },
    };

    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimAppointmentReminderDelivery(tx as never, {
          deliveryId: 'delivery-1',
          now: NOW,
          leaseMs: 5 * 60_000,
        }),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(tx.appointmentReminderDelivery.findUnique).toHaveBeenCalledTimes(20);
    expect(tx.appointmentReminderDelivery.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('does not reclaim a live lease after a crash', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(lockedSchedule()),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery({ status: 'IN_FLIGHT' })),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-1',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toBeNull();
    expect(tx.appointmentReminderDelivery.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('does not claim a stale row when the appointment is rescheduled after selection', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(lockedSchedule(new Date('2026-08-19T14:00:00.000Z'))),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery({ status: 'PENDING' })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(delivery()),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-1',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toBeNull();
    expect(tx.appointmentReminderDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('reclaims an expired in-flight lease', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(lockedSchedule()),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery({ status: 'IN_FLIGHT' })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(delivery({ attemptCount: 2 })),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-1',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toMatchObject({ attemptCount: 2 });
    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery-1',
        scheduledStartAt: SCHEDULED_START,
        OR: [
          { status: 'PENDING', leaseExpiresAt: null },
          { status: { in: ['FAILED', 'IN_FLIGHT'] }, leaseExpiresAt: { lte: NOW } },
        ],
      },
      data: {
        status: 'IN_FLIGHT',
        attemptCount: { increment: 1 },
        leaseExpiresAt: LEASE_END,
        lastError: null,
      },
    });
  });
});

describe('delivery completion and retry', () => {
  it('updates the compatibility marker only when delivery is marked delivered', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      appointment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await expect(completeAppointmentReminderDelivery(tx as never, delivery(), NOW)).resolves.toBe(
      true,
    );

    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery-1',
        status: 'IN_FLIGHT',
        providerIdempotencyKey: 'appointment-reminder:appt-1:1787061600000:2H',
        leaseExpiresAt: LEASE_END,
      },
      data: { status: 'DELIVERED', deliveredAt: NOW, leaseExpiresAt: null, lastError: null },
    });
    expect(tx.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt-1', status: 'CONFIRMED' },
      data: { reminded2At: NOW },
    });
  });

  it('records a compact non-PHI error and schedules transient failure retry', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await failAppointmentReminderDelivery(
      tx as never,
      delivery(),
      { code: 'SENDGRID_503', transient: true, detail: 'patient@example.com socket timeout' },
      NOW,
    );

    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery-1',
        status: 'IN_FLIGHT',
        providerIdempotencyKey: 'appointment-reminder:appt-1:1787061600000:2H',
        leaseExpiresAt: LEASE_END,
      },
      data: {
        status: 'FAILED',
        leaseExpiresAt: new Date('2026-08-18T12:01:00.000Z'),
        lastError: 'SENDGRID_503',
      },
    });
  });

  it('backs off exponentially and caps retries at one hour', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await failAppointmentReminderDelivery(
      tx as never,
      delivery({ attemptCount: 20 }),
      { code: 'SENDGRID_503', transient: true },
      NOW,
    );

    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseExpiresAt: new Date('2026-08-18T13:00:00.000Z'),
        }),
      }),
    );
  });

  it('keeps the same provider idempotency key when a failed delivery retries', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(lockedSchedule()),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(delivery({ status: 'FAILED' })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue(delivery({ status: 'IN_FLIGHT', attemptCount: 2 })),
      },
    };

    const retried = await claimAppointmentReminderDelivery(tx as never, {
      deliveryId: 'delivery-1',
      now: NOW,
      leaseMs: 5 * 60_000,
    });

    expect(retried?.providerIdempotencyKey).toBe('appointment-reminder:appt-1:1787061600000:2H');
  });
});
