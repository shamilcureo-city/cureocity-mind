import { describe, expect, it, vi } from 'vitest';
import {
  beginAppointmentReminderSubmission,
  claimAppointmentReminderDelivery,
  completeAppointmentReminderDelivery,
  enqueueDueAppointmentReminderDeliveries,
  failAppointmentReminderBeforeSubmission,
  markAppointmentReminderSubmissionUnknown,
} from './appointment-reminder-outbox';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const LEASE_END = new Date('2026-08-18T12:05:00.000Z');
const START = new Date('2026-08-18T14:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-patient',
    appointmentId: 'appt-1',
    scheduledStartAt: START,
    kind: 'H2' as const,
    recipient: 'PATIENT_EMAIL' as const,
    status: 'DISPATCHING' as const,
    attemptCount: 1,
    leaseExpiresAt: LEASE_END,
    submissionStartedAt: null,
    ...overrides,
  };
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    psychologistId: 'psy-1',
    status: 'CONFIRMED',
    startAt: START,
    patientEmailEncrypted: 'ciphertext',
    ...overrides,
  };
}

describe('recipient reminder enqueue', () => {
  it('creates independent practitioner and patient rows without storing an email address', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: 'appt-1', startAt: START, hasPatientEmail: true }]),
      appointmentReminderDelivery: { createMany },
    };

    await expect(
      enqueueDueAppointmentReminderDeliveries(db as never, {
        kind: 'H2',
        reminderKind: '2H',
        startAt: { gt: NOW, lte: START },
        take: 200,
      }),
    ).resolves.toBe(2);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          appointmentId: 'appt-1',
          scheduledStartAt: START,
          kind: 'H2',
          recipient: 'PRACTITIONER_EMAIL',
        },
        {
          appointmentId: 'appt-1',
          scheduledStartAt: START,
          kind: 'H2',
          recipient: 'PATIENT_EMAIL',
        },
      ],
      skipDuplicates: true,
    });
    expect(JSON.stringify(createMany.mock.calls)).not.toContain('@');
  });
});

describe('at-most-once submission state machine', () => {
  it('claims one recipient independently and derives its availability from the locked appointment', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([appointment()]),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(row({ status: 'PENDING', leaseExpiresAt: null })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(row()),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-patient',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toMatchObject({ recipient: 'PATIENT_EMAIL', status: 'DISPATCHING' });
    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DISPATCHING', leaseExpiresAt: LEASE_END }),
      }),
    );
  });

  it('does not claim a patient row when the locked appointment has no patient email', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([appointment({ patientEmailEncrypted: null })]),
      appointmentReminderDelivery: {
        findUnique: vi.fn().mockResolvedValue(row({ status: 'PENDING', leaseExpiresAt: null })),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-patient',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toBeNull();
    expect(tx.appointmentReminderDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('commits SUBMISSION_STARTED before the provider call boundary', async () => {
    const tx = {
      appointmentReminderDelivery: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'SUBMISSION_STARTED', leaseExpiresAt: null, submissionStartedAt: NOW }),
          ),
      },
    };

    await expect(
      beginAppointmentReminderSubmission(tx as never, row(), NOW),
    ).resolves.toMatchObject({
      status: 'SUBMISSION_STARTED',
      submissionStartedAt: NOW,
    });
    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-patient', status: 'DISPATCHING', leaseExpiresAt: LEASE_END },
      data: { status: 'SUBMISSION_STARTED', submissionStartedAt: NOW, leaseExpiresAt: null },
    });
  });

  it('never automatically reclaims SUBMISSION_STARTED after restart or lease expiry', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([appointment()]),
      appointmentReminderDelivery: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            row({ status: 'SUBMISSION_STARTED', leaseExpiresAt: new Date(NOW.getTime() - 1) }),
          ),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(
      claimAppointmentReminderDelivery(tx as never, {
        deliveryId: 'delivery-patient',
        now: NOW,
        leaseMs: 5 * 60_000,
      }),
    ).resolves.toBeNull();
    expect(tx.appointmentReminderDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('records timeout ambiguity as PHI-free UNKNOWN and never makes it retryable', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await markAppointmentReminderSubmissionUnknown(
      tx as never,
      row({ status: 'SUBMISSION_STARTED', leaseExpiresAt: null, submissionStartedAt: NOW }),
      { code: 'SENDGRID_NETWORK', detail: 'patient@example.com timed out' },
    );

    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-patient', status: 'SUBMISSION_STARTED', submissionStartedAt: NOW },
      data: { status: 'UNKNOWN', leaseExpiresAt: null, lastError: 'SENDGRID_NETWORK' },
    });
    expect(JSON.stringify(tx.appointmentReminderDelivery.updateMany.mock.calls)).not.toContain(
      'patient@example.com',
    );
  });

  it('allows a config failure to retry only before SUBMISSION_STARTED', async () => {
    const tx = {
      appointmentReminderDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await failAppointmentReminderBeforeSubmission(
      tx as never,
      row(),
      { code: 'SENDGRID_NOT_CONFIGURED' },
      NOW,
    );

    expect(tx.appointmentReminderDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-patient', status: 'DISPATCHING', leaseExpiresAt: LEASE_END },
      data: {
        status: 'FAILED',
        leaseExpiresAt: new Date('2026-08-18T12:01:00.000Z'),
        lastError: 'SENDGRID_NOT_CONFIGURED',
      },
    });
  });

  it('sets the compatibility timestamp only after every recipient row is DELIVERED', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const updateAppointment = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      appointmentReminderDelivery: { updateMany, count },
      appointment: { updateMany: updateAppointment },
    };
    const submitted = row({
      status: 'SUBMISSION_STARTED',
      leaseExpiresAt: null,
      submissionStartedAt: NOW,
    });

    await expect(completeAppointmentReminderDelivery(tx as never, submitted, NOW)).resolves.toBe(
      true,
    );
    expect(updateAppointment).not.toHaveBeenCalled();

    await expect(completeAppointmentReminderDelivery(tx as never, submitted, NOW)).resolves.toBe(
      true,
    );
    expect(updateAppointment).toHaveBeenCalledWith({
      where: { id: 'appt-1', status: 'CONFIRMED', startAt: START },
      data: { reminded2At: NOW },
    });
  });
});
