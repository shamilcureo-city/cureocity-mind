import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  account: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
  demo: vi.fn(),
  after: vi.fn(),
}));
vi.mock('./onboarding-access', () => ({ requireOnboardingIdentity: h.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
vi.mock('./demo-client', () => ({ createDemoClient: h.demo }));
vi.mock('./mappers', () => ({ toPsychologist: (row: unknown) => row }));
vi.mock('./welcome-email', () => ({ sendWelcomeEmail: h.email }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: h.after,
}));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: h.account },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ psychologist: { update: h.update } }),
  },
}));
import { POST } from '../app/api/v1/onboarding/complete/route';
const payload = {
  fullName: 'Fictional Doctor',
  email: 'fictional@example.test',
  vertical: 'DOCTOR',
  medicalRegNumber: 'FICTIONAL-REG',
  specialty: 'family medicine',
  defaultOutputLanguage: 'en',
  phone: '+971500000000',
};
const request = (extra = {}) =>
  POST(
    new NextRequest('https://scribe.cureocity.in/api/v1/onboarding/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, ...extra }),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor', user: { vertical: 'DOCTOR' }, pendingApproval: true },
  });
  h.account.mockResolvedValue({ onboardingCompletedAt: null, phone: 'pending:original-uid' });
  h.update.mockResolvedValue({
    id: 'doctor',
    email: payload.email,
    fullName: payload.fullName,
    status: 'PENDING_VERIFICATION',
  });
  h.email.mockResolvedValue({ outcome: 'sent' });
});
describe('pending Scribe registration submission', () => {
  it('saves self-reported details and audit without approving or minting permissions', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const change = h.update.mock.calls[0]?.[0];
    expect(change.where).toMatchObject({
      id: 'doctor',
      onboardingCompletedAt: null,
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
    });
    expect(change.data).toMatchObject({
      medicalRegNumber: 'FICTIONAL-REG',
      vertical: 'DOCTOR',
      onboardingCompletedAt: expect.any(Date),
    });
    for (const key of [
      'status',
      'role',
      'profession',
      'credentialVerifiedAt',
      'credentials',
      'firebaseUid',
      'capabilities',
    ])
      expect(change.data).not.toHaveProperty(key);
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.email).toHaveBeenCalledWith({
      to: payload.email,
      fullName: payload.fullName,
      vertical: 'DOCTOR',
    });
    expect(h.after).not.toHaveBeenCalled();
    expect(h.demo).not.toHaveBeenCalled();
  });
  it('cannot use the pending exception for a therapist profile', async () => {
    expect((await request({ vertical: 'THERAPIST', rciNumber: 'FICTIONAL-RCI' })).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('does not permit repeat registration after completion', async () => {
    h.account.mockResolvedValue({
      onboardingCompletedAt: new Date(),
      phone: 'pending:original-uid',
    });
    expect((await request()).status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('rejects concurrent completion or suspension without an approval write', async () => {
    h.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('row no longer eligible', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    expect((await request()).status).toBe(409);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
});
