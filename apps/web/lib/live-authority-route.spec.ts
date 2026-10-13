import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentAuthorizationError } from './consent-gate';

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  consentFindMany: vi.fn(),
  queryRaw: vi.fn(),
  getEffectiveCapabilities: vi.fn(),
  writeAudit: vi.fn(),
  teleconsult: vi.fn(),
  transaction: vi.fn(),
  PractitionerInactiveAuthorizationError: class extends Error {},
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    consent: { findMany: mocks.consentFindMany },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  PractitionerInactiveAuthorizationError: mocks.PractitionerInactiveAuthorizationError,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@/lib/scribe-teleconsult', () => ({
  assertScribeTeleconsultDocumentationConsent: mocks.teleconsult,
}));

import { POST } from '../app/api/v1/internal/live-authority/route';

const SESSION_ID = 'c123456789012345678901234';
const PSYCHOLOGIST_ID = 'cabcdefghijklmnopqrstuvwx';

const request = (
  secret = 'service-secret',
  purpose?: 'capture' | 'queued-finalization',
  overrides: { vertical?: 'DOCTOR' | 'THERAPIST'; tokenExpiresAt?: number } = {},
) =>
  new Request('https://web.internal/api/v1/internal/live-authority', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      psychologistId: PSYCHOLOGIST_ID,
      tokenExpiresAt: 2_000_000_000,
      vertical: 'DOCTOR',
      ...(purpose ? { purpose } : {}),
      ...overrides,
    }),
  }) as never;

describe('internal live authority verifier', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('LIVE_GATEWAY_SECRET', 'service-secret');
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        session: { findUnique: mocks.sessionFindUnique },
        consent: { findMany: mocks.consentFindMany },
        $queryRaw: mocks.queryRaw,
      }),
    );
    mocks.teleconsult.mockResolvedValue(undefined);
    mocks.sessionFindUnique.mockResolvedValue({
      psychologistId: PSYCHOLOGIST_ID,
      status: 'IN_PROGRESS',
      captureMode: 'LIVE',
      clientId: 'c987654321098765432109876',
      psychologist: { vertical: 'DOCTOR' },
    });
    mocks.consentFindMany.mockResolvedValue([
      { scope: 'AUDIO_RECORDING' },
      { scope: 'AI_NOTE_GENERATION' },
      { scope: 'CROSS_BORDER_PROCESSING' },
    ]);
    mocks.getEffectiveCapabilities.mockResolvedValue({
      capabilities: new Set(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS']),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects a missing or invalid service secret without querying authority', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it('returns only current capabilities for the server-owned session', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorized: true,
      capabilities: ['CLINICAL_ANALYSIS', 'LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'],
    });
    expect(mocks.getEffectiveCapabilities).toHaveBeenCalledWith(PSYCHOLOGIST_ID);
    expect(mocks.teleconsult).toHaveBeenCalledWith(
      expect.anything(),
      SESSION_ID,
      PSYCHOLOGIST_ID,
      'capture',
    );
  });

  it('defaults old gateway requests to capture and separately authorizes consented queued output', async () => {
    mocks.teleconsult.mockImplementation(async (_tx, _sessionId, _ownerId, purpose) => {
      if (purpose !== 'queued-finalization') throw new ConsentAuthorizationError('paused capture');
    });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request('service-secret', 'capture'))).status).toBe(403);
    expect((await POST(request('service-secret', 'queued-finalization'))).status).toBe(200);
  });

  it('fails closed and safely audits typed inactive-practitioner denial', async () => {
    mocks.getEffectiveCapabilities.mockRejectedValue(
      new mocks.PractitionerInactiveAuthorizationError(),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'LiveAuthority',
        targetId: 'DENIED',
        metadata: { source: 'liveGatewayRevalidation', sessionId: SESSION_ID },
      }),
    );
  });

  it.each([
    ['withdrawal', [{ scope: 'AI_NOTE_GENERATION' }, { scope: 'CROSS_BORDER_PROCESSING' }]],
    ['expiry', [{ scope: 'AUDIO_RECORDING' }, { scope: 'CROSS_BORDER_PROCESSING' }]],
    ['missing scope', [{ scope: 'AUDIO_RECORDING' }, { scope: 'AI_NOTE_GENERATION' }]],
  ])('denies post-connect output after consent %s', async (_label, currentConsents) => {
    mocks.consentFindMany.mockResolvedValue(currentConsents);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'COMPLETED', captureMode: 'LIVE' },
    { status: 'CANCELLED', captureMode: 'LIVE' },
    { status: 'IN_PROGRESS', captureMode: 'DICTATE' },
    { status: 'IN_PROGRESS', captureMode: 'LIVE', mindDocumentationMode: 'MANUAL' },
  ])('denies a session outside the active live lifecycle (%o)', async (sessionState) => {
    mocks.sessionFindUnique.mockResolvedValue({
      psychologistId: PSYCHOLOGIST_ID,
      psychologist: { vertical: 'DOCTOR' },
      ...sessionState,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('keeps the denial response authoritative when denial auditing is unavailable', async () => {
    mocks.getEffectiveCapabilities.mockRejectedValue(
      new mocks.PractitionerInactiveAuthorizationError(),
    );
    mocks.writeAudit.mockRejectedValue(new Error('audit unavailable'));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
  });

  it('rejects an invalid authority payload before querying session state', async () => {
    const invalid = new Request('https://web.internal/api/v1/internal/live-authority', {
      method: 'POST',
      headers: {
        authorization: 'Bearer service-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sessionId: '', psychologistId: 'psy-1' }),
    }) as never;

    expect((await POST(invalid)).status).toBe(400);
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'returns current authority for %s without crossing vertical boundaries',
    async (vertical) => {
      mocks.sessionFindUnique.mockResolvedValue({
        psychologistId: PSYCHOLOGIST_ID,
        status: 'IN_PROGRESS',
        captureMode: 'LIVE',
        clientId: 'c987654321098765432109876',
        psychologist: { vertical },
      });
      const capabilities = [
        'LIVE_ENCOUNTER',
        vertical === 'DOCTOR' ? 'MEDICAL_DOCUMENTATION' : 'BEHAVIORAL_HEALTH_DOCUMENTATION',
      ];
      mocks.getEffectiveCapabilities.mockResolvedValue({ capabilities: new Set(capabilities) });

      const response = await POST(request('service-secret', 'capture', { vertical }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        authorized: true,
        capabilities: capabilities.sort(),
      });
      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(mocks.teleconsult).toHaveBeenCalledTimes(vertical === 'DOCTOR' ? 1 : 0);
    },
  );

  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'denies %s after standing consent withdrawal and does not label it an outage',
    async (vertical) => {
      mocks.sessionFindUnique.mockResolvedValue({
        psychologistId: PSYCHOLOGIST_ID,
        status: 'IN_PROGRESS',
        captureMode: 'LIVE',
        psychologist: { vertical },
      });
      mocks.consentFindMany.mockResolvedValue([]);
      const response = await POST(request('service-secret', 'queued-finalization', { vertical }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
      expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
      expect(mocks.writeAudit).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['missing session', null],
    ['owner mismatch', { psychologistId: 'another-practitioner' }],
    [
      'vertical mismatch',
      { psychologistId: PSYCHOLOGIST_ID, psychologist: { vertical: 'THERAPIST' } },
    ],
  ])('denies %s before fetching capabilities', async (_label, session) => {
    mocks.sessionFindUnique.mockResolvedValue(session);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('denies an expired token even if the current session and consent are valid', async () => {
    expect((await POST(request('service-secret', 'capture', { tokenExpiresAt: 1 }))).status).toBe(
      403,
    );
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'returns no authority and sanitized 503 for %s capability dependency failure',
    async (vertical) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.sessionFindUnique.mockResolvedValue({
        psychologistId: PSYCHOLOGIST_ID,
        status: 'IN_PROGRESS',
        captureMode: 'LIVE',
        psychologist: { vertical },
      });
      mocks.getEffectiveCapabilities.mockRejectedValue(new Error('sensitive database details'));

      const response = await POST(request('service-secret', 'capture', { vertical }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
      expect(mocks.writeAudit).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        '[live-authority] Verification unavailable.',
        {
          stage: 'capabilities',
        },
      );
    },
  );

  it.each(['transaction', 'session', 'consent', 'teleconsult'] as const)(
    'returns no authority and sanitized 503 when %s snapshot dependency fails',
    async (stage) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const dependency = {
        transaction: mocks.transaction,
        session: mocks.sessionFindUnique,
        consent: mocks.consentFindMany,
        teleconsult: mocks.teleconsult,
      }[stage];
      dependency.mockRejectedValue(new Error('sensitive database details'));

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
      expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
      expect(mocks.writeAudit).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        '[live-authority] Verification unavailable.',
        {
          stage: 'session_snapshot',
        },
      );
    },
  );
});
