import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEmailPort } from '@cureocity/notifications';

const mocks = vi.hoisted(() => ({
  psychologistFindUnique: vi.fn(),
  decryptForTenant: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { psychologist: { findUnique: mocks.psychologistFindUnique } },
}));
vi.mock('@/lib/tenant-crypto', () => ({ decryptForTenant: mocks.decryptForTenant }));
vi.mock('@/lib/appointment-links', () => ({
  publicBaseUrl: () => 'https://mind.example',
  signAppointmentId: () => 'signed',
}));
vi.mock('@/lib/livekit', () => ({ livekitConfigured: () => false }));

import { prepareAppointmentReminderEmail } from './appointment-email';

const appointment = {
  id: 'appt-1',
  psychologistId: 'psy-1',
  startAt: new Date('2026-08-18T14:00:00.000Z'),
  mode: 'ONLINE',
  patientEmailEncrypted: 'ciphertext',
};

beforeEach(() => {
  delete process.env['SENDGRID_API_KEY'];
  delete process.env['SENDGRID_FROM_EMAIL'];
  globalThis.__cureocityAppointmentEmail = undefined;
  mocks.psychologistFindUnique.mockReset().mockResolvedValue({
    email: 'therapist@example.com',
    fullName: 'Dr Test',
    videoCallLink: null,
    officeAddress: null,
  });
  mocks.decryptForTenant.mockReset().mockResolvedValue('patient@example.com');
});

afterEach(() => {
  globalThis.__cureocityAppointmentEmail = undefined;
});

describe('prepareAppointmentReminderEmail', () => {
  it('returns a retryable pre-dispatch config failure before any provider call', async () => {
    await expect(
      prepareAppointmentReminderEmail({
        appointment,
        recipient: 'PRACTITIONER_EMAIL',
        windowHours: 2,
      }),
    ).resolves.toEqual({
      outcome: 'pre_dispatch_failure',
      errorCode: 'SENDGRID_NOT_CONFIGURED',
    });
  });

  it('does not call the provider until the caller has committed SUBMISSION_STARTED', async () => {
    const sendEmail = vi.fn().mockResolvedValue({
      outcome: 'sent',
      providerMessageId: 'sendgrid:accepted',
    });
    globalThis.__cureocityAppointmentEmail = { sendEmail } as IEmailPort;

    const prepared = await prepareAppointmentReminderEmail({
      appointment,
      recipient: 'PRACTITIONER_EMAIL',
      windowHours: 2,
    });

    expect(prepared.outcome).toBe('ready');
    expect(sendEmail).not.toHaveBeenCalled();
    if (prepared.outcome !== 'ready') throw new Error('expected ready');
    await expect(prepared.submit()).resolves.toMatchObject({ outcome: 'sent' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).not.toHaveProperty('idempotencyKey');
  });

  it('builds exactly one patient provider request for a patient row', async () => {
    const sendEmail = vi.fn().mockResolvedValue({
      outcome: 'transient_failure',
      errorCode: 'SENDGRID_NETWORK',
    });
    globalThis.__cureocityAppointmentEmail = { sendEmail } as IEmailPort;

    const prepared = await prepareAppointmentReminderEmail({
      appointment,
      recipient: 'PATIENT_EMAIL',
      windowHours: 24,
    });
    if (prepared.outcome !== 'ready') throw new Error('expected ready');
    await prepared.submit();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'patient@example.com' }));
  });

  it('keeps practitioner and patient outcomes independent', async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'sent', providerMessageId: 'sendgrid:practitioner' })
      .mockResolvedValueOnce({ outcome: 'transient_failure', errorCode: 'SENDGRID_NETWORK' });
    globalThis.__cureocityAppointmentEmail = { sendEmail } as IEmailPort;

    const practitioner = await prepareAppointmentReminderEmail({
      appointment,
      recipient: 'PRACTITIONER_EMAIL',
      windowHours: 2,
    });
    const patient = await prepareAppointmentReminderEmail({
      appointment,
      recipient: 'PATIENT_EMAIL',
      windowHours: 2,
    });
    if (practitioner.outcome !== 'ready' || patient.outcome !== 'ready') {
      throw new Error('expected ready');
    }

    await expect(practitioner.submit()).resolves.toMatchObject({ outcome: 'sent' });
    await expect(patient.submit()).resolves.toMatchObject({
      outcome: 'transient_failure',
      errorCode: 'SENDGRID_NETWORK',
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
