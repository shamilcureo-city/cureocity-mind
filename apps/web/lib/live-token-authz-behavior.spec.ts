import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  requireCapability: vi.fn(),
  findSession: vi.fn(),
  findConsents: vi.fn(),
  transaction: vi.fn(),
  signLiveToken: vi.fn(),
  fetchActiveMedications: vi.fn(),
  fetchAllergies: vi.fn(),
  assertValidScribeConsent: vi.fn(),
  withClientConsentLock: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('./live-token', () => ({ signLiveToken: mocks.signLiveToken }));
vi.mock('./patient-context', () => ({
  fetchActiveMedications: mocks.fetchActiveMedications,
  fetchAllergies: mocks.fetchAllergies,
}));
vi.mock('./consent-gate', () => ({
  assertValidScribeConsent: mocks.assertValidScribeConsent,
  ConsentAuthorizationError: class ConsentAuthorizationError extends Error {},
  consentAuthorizationResponse: vi.fn(() => null),
  withClientConsentLock: mocks.withClientConsentLock,
}));
vi.mock('./session-transition', () => ({
  assertLiveTokenSessionStatus: vi.fn(),
  conditionalSessionTransition: vi.fn(),
  sessionConcurrentModificationResponse: vi.fn(() => null),
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.findSession },
    consent: { findMany: mocks.findConsents },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '../app/api/v1/sessions/[id]/live-token/route';

const auth = {
  ok: true as const,
  value: {
    psychologistId: 'psy-1',
    user: { firebaseUid: 'uid', capabilities: [] as string[] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue(auth);
  mocks.transaction.mockImplementation(async (callback) =>
    callback({ session: { findUnique: mocks.findSession } }),
  );
  mocks.withClientConsentLock.mockImplementation(async (_tx, _clientId, callback) => callback());
  mocks.findSession.mockResolvedValue({
    psychologistId: 'psy-1',
    status: 'IN_PROGRESS',
    consentSnapshot: {},
    clientId: 'client-1',
    psychologist: { vertical: 'DOCTOR' },
  });
  mocks.signLiveToken.mockReturnValue({ token: 'signed', expiresInSec: 300 });
  mocks.fetchActiveMedications.mockResolvedValue(['warfarin']);
  mocks.fetchAllergies.mockResolvedValue(['penicillin']);
});

const request = () =>
  POST(
    new Request('https://example.test/api/v1/sessions/session-1/live-token', {
      method: 'POST',
    }) as never,
    {
      params: Promise.resolve({ id: 'session-1' }),
    },
  );

describe('live-token capability boundary', () => {
  it.each(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'] as const)(
    'returns the audited 403 before minting when %s is absent or revoked',
    async (missing) => {
      mocks.requireCapability.mockImplementation(async (_req, capability) =>
        capability === missing
          ? {
              ok: false,
              response: new Response(JSON.stringify({ error: 'not authorized' }), { status: 403 }),
            }
          : auth,
      );

      const response = await request();

      expect(response.status).toBe(403);
      expect(mocks.signLiveToken).not.toHaveBeenCalled();
      expect(mocks.fetchActiveMedications).not.toHaveBeenCalled();
      expect(mocks.fetchAllergies).not.toHaveBeenCalled();
    },
  );

  it('mints reconnect tokens with only current optional capabilities and suppresses Rx context', async () => {
    const scopedAuth = {
      ...auth,
      value: {
        ...auth.value,
        user: {
          ...auth.value.user,
          capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'],
        },
      },
    };
    mocks.requireCapability.mockResolvedValue(scopedAuth);

    const response = await request();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: 'signed',
      expiresInSec: 300,
      capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'],
    });
    expect(mocks.signLiveToken).toHaveBeenCalledWith({
      sessionId: 'session-1',
      psychologistId: 'psy-1',
      vertical: 'DOCTOR',
      capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'],
    });
    expect(mocks.fetchActiveMedications).not.toHaveBeenCalled();
    expect(mocks.fetchAllergies).not.toHaveBeenCalled();
  });
});
