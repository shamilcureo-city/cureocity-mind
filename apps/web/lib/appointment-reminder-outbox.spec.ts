import { describe, expect, it, vi } from 'vitest';
import {
  claimAppointmentReminderDelivery,
  completeAppointmentReminderDelivery,
  failAppointmentReminderDelivery,
  providerIdempotencyKey,
  reminderKindForStart,
} from './appointment-reminder-outbox';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const LEASE_END = new Date('2026-08-18T12:05:00.000Z');

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    appointmentId: 'appt-1',
    kind: 'H2' as const,
    status: 'IN_FLIGHT' as const,
    attemptCount: 1,
    leaseExpiresAt: LEASE_END,
    providerIdempotencyKey: 'appointment-reminder:appt-1:2H',
    ...overrides,
  };
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
  it('is stable per appointment and reminder kind', () => {
    expect(providerIdempotencyKey('appt-1', '24H')).toBe('appointment-reminder:appt-1:24H');
    expect(providerIdempotencyKey('appt-1', '2H')).toBe('appointment-reminder:appt-1:2H');
  });
});

describe('claimAppointmentReminderDelivery', () => {
  it('allows exactly one of twenty concurrent workers to claim', async () => {
    let available = true;
    const tx = {
      appointmentReminderDelivery: {
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
    expect(tx.appointmentReminderDelivery.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('does not reclaim a live lease after a crash', async () => {
    const tx = {
      appointmentReminderDelivery: {
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

  it('reclaims an expired in-flight lease', async () => {
    const tx = {
      appointmentReminderDelivery: {
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
        appointment: { status: 'CONFIRMED', startAt: { gt: NOW } },
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
        providerIdempotencyKey: 'appointment-reminder:appt-1:2H',
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
        providerIdempotencyKey: 'appointment-reminder:appt-1:2H',
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
      appointmentReminderDelivery: {
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

    expect(retried?.providerIdempotencyKey).toBe('appointment-reminder:appt-1:2H');
  });
});
