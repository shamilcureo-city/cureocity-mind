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
  transition: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('./live-token', () => ({ signLiveToken: mocks.signLiveToken }));
vi.mock('./scribe-teleconsult', () => ({ assertScribeTeleconsultDocumentationConsent: vi.fn() }));
vi.mock('./patient-context', () => ({
  fetchActiveMedications: mocks.fetchActiveMedications,
  fetchAllergies: mocks.fetchAllergies,
}));
vi.mock('./consent-gate', () => ({
  assertValidScribeConsent: mocks.assertValidScribeConsent,
  ConsentAuthorizationError: class ConsentAuthorizationError extends Error {},
  consentAuthorizationResponse: vi.fn(
    (error: Error) => new Response(JSON.stringify({ error: error.message }), { status: 409 }),
  ),
  withClientConsentLock: mocks.withClientConsentLock,
}));
vi.mock('./session-transition', () => ({
  assertLiveTokenSessionStatus: vi.fn(),
  conditionalSessionTransition: mocks.transition,
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
    captureMode: 'LIVE',
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
  it('reserves live capture without advancing lifecycle or consuming a startup credit', async () => {
    mocks.requireCapability.mockResolvedValue(auth);
    mocks.findSession.mockResolvedValue({
      psychologistId: 'psy-1',
      clientId: 'client-1',
      status: 'SCHEDULED',
      captureMode: null,
      consentSnapshot: { captureMode: 'LIVE' },
      psychologist: { vertical: 'DOCTOR' },
    });
    expect((await request()).status).toBe(200);
    expect(mocks.transition).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      expectedStatus: 'SCHEDULED',
      data: { captureMode: 'LIVE' },
    });
    expect(mocks.transition.mock.calls[0]?.[1].data).not.toHaveProperty('startedAt');
    expect(mocks.transition.mock.calls[0]?.[1].data).not.toHaveProperty('status');
  });
  it.each(['DICTATE', 'UPLOAD'])(
    'rejects a live token for an in-progress %s encounter',
    async (captureMode) => {
      mocks.requireCapability.mockResolvedValue(auth);
      mocks.findSession.mockResolvedValue({
        psychologistId: 'psy-1',
        clientId: 'client-1',
        status: 'IN_PROGRESS',
        captureMode,
        consentSnapshot: {},
        psychologist: { vertical: 'DOCTOR' },
      });
      expect((await request()).status).toBe(409);
      expect(mocks.signLiveToken).not.toHaveBeenCalled();
    },
  );
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
