import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
  psychologistFindUnique: vi.fn(),
  psychologistUpdate: vi.fn(),
  psychologistCreate: vi.fn(),
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
    psychologist: { update: mocks.psychologistUpdate, create: mocks.psychologistCreate },
  };
  return {
    prisma: {
      psychologist: { findUnique: mocks.psychologistFindUnique },
      $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { POST } from '../app/api/v1/auth/session/route';

describe('practitioner phone identity preservation', () => {
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

  it('refuses a different phone identity without replacing the original Google/email identity', async () => {
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

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SIGNIN_METHOD_CONFLICT' });
    expect(mocks.psychologistUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('keeps sign-in with the original canonical UID working', async () => {
    mocks.psychologistFindUnique
      .mockReset()
      .mockResolvedValue({ id: 'psy-1', deletedAt: null, firebaseUid: 'firebase-old' });
    mocks.verifyIdToken.mockResolvedValue({ uid: 'firebase-old', email: 'fictional@example.test' });
    const response = await POST(
      new Request('https://scribe.cureocity.in/api/v1/auth/session', {
        method: 'POST',
        headers: {
          origin: 'https://scribe.cureocity.in',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: '{}',
      }) as never,
    );
    expect(response.status).toBe(200);
    expect(mocks.createSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.psychologistUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ['scribe.cureocity.in', 'DOCTOR'],
    ['mind.cureocity.in', undefined],
  ])('keeps new %s registration in its own product without approval', async (host, vertical) => {
    mocks.psychologistFindUnique.mockReset().mockResolvedValue(null);
    mocks.verifyIdToken.mockResolvedValue({ uid: 'new-uid', email: 'fictional@example.test' });
    mocks.psychologistCreate.mockResolvedValue({
      id: 'new-owner',
      deletedAt: null,
      fullName: 'Fictional',
    });
    const response = await POST(
      new Request(`https://${host}/api/v1/auth/session`, {
        method: 'POST',
        headers: {
          origin: `https://${host}`,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: '{}',
      }) as never,
    );
    expect(response.status).toBe(200);
    const data = mocks.psychologistCreate.mock.calls[0]?.[0].data;
    expect(data.vertical).toBe(vertical);
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('credentialVerifiedAt');
  });
});
