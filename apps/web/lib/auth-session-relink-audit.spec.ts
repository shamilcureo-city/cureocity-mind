import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
  psychologistFindUnique: vi.fn(),
  psychologistUpdate: vi.fn(),
  clientFindUnique: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  SESSION_COOKIE_MAX_AGE_MS: 3600000,
  SESSION_COOKIE_NAME: 'session',
  assertUidAvailableForPractitioner: vi.fn(async () => ({ ok: true })),
  isAuthBypassed: vi.fn(() => false),
  sessionCookieDomain: vi.fn(() => undefined),
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('./firebase-admin', () => ({
  firebaseAuth: vi.fn(() => ({
    verifyIdToken: mocks.verifyIdToken,
    createSessionCookie: mocks.createSessionCookie,
  })),
}));
vi.mock('./invite', () => ({
  isPilotInviteRequired: vi.fn(() => false),
  redeemInviteCode: vi.fn(),
}));
vi.mock('./referral', () => ({ redeemReferralAtSignup: vi.fn() }));
vi.mock('./clinic', () => ({ ensurePersonalClinic: vi.fn() }));
vi.mock('./validate', () => ({
  parseJson: vi.fn(async () => ({ ok: true, value: { idToken: 'id-token' } })),
}));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: mocks.executeRaw,
    client: { findUnique: mocks.clientFindUnique },
    psychologist: { update: mocks.psychologistUpdate },
  };
  return {
    prisma: {
      psychologist: { findUnique: mocks.psychologistFindUnique },
      $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { POST } from '../app/api/v1/auth/session/route';

describe('practitioner phone relink audit minimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockResolvedValue({
      uid: 'firebase-new',
      phone_number: '+919999999999',
    });
    mocks.createSessionCookie.mockResolvedValue('cookie');
    mocks.psychologistFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'psy-1', deletedAt: null, firebaseUid: 'firebase-old' });
    mocks.clientFindUnique.mockResolvedValue(null);
    mocks.psychologistUpdate.mockResolvedValue({ id: 'psy-1' });
  });

  it('records only categorical/internal relink provenance, never phone or Firebase UIDs', async () => {
    const response = await POST(
      new Request('https://example.test/api/v1/auth/session', {
        method: 'POST',
        headers: {
          origin: 'https://example.test',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: '{}',
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    const audit = mocks.writeAudit.mock.calls[0]?.[0];
    expect(audit).toMatchObject({
      action: 'PSYCHOLOGIST_UPDATED',
      targetId: 'psy-1',
      metadata: { event: 'firebase-uid-relinked-via-phone-otp' },
    });
    expect(audit.metadata).toEqual({ event: 'firebase-uid-relinked-via-phone-otp' });
    expect(JSON.stringify(audit.metadata)).not.toContain('+919999999999');
    expect(JSON.stringify(audit.metadata)).not.toContain('firebase-old');
    expect(JSON.stringify(audit.metadata)).not.toContain('firebase-new');
  });
});
