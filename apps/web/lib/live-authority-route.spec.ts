import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  consentFindMany: vi.fn(),
  queryRaw: vi.fn(),
  getEffectiveCapabilities: vi.fn(),
  writeAudit: vi.fn(),
  teleconsult: vi.fn(),
  prepareCapture: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    consent: { findMany: mocks.consentFindMany },
    $queryRaw: mocks.queryRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        session: { findUnique: mocks.sessionFindUnique },
        consent: { findMany: mocks.consentFindMany },
        $queryRaw: mocks.queryRaw,
      }),
    ),
  },
}));
vi.mock('@/lib/capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@/lib/scribe-teleconsult', () => ({
  assertScribeTeleconsultDocumentationConsent: mocks.teleconsult,
}));
vi.mock('@/lib/scribe-capture-activation', () => ({
  authorizeScribeCapturePreparation: mocks.prepareCapture,
}));

import { POST } from '../app/api/v1/internal/live-authority/route';

const SESSION_ID = 'c123456789012345678901234';
const PSYCHOLOGIST_ID = 'cabcdefghijklmnopqrstuvwx';

const request = (
  secret = 'service-secret',
  purpose?: 'capture' | 'queued-finalization' | 'preflight' | 'capture-activation',
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
    }),
  }) as never;

describe('internal live authority verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['LIVE_GATEWAY_SECRET'] = 'service-secret';
    mocks.teleconsult.mockResolvedValue(undefined);
    mocks.prepareCapture.mockResolvedValue(['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION']);
    mocks.writeAudit.mockResolvedValue(undefined);
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
      if (purpose !== 'queued-finalization') throw new Error('paused capture');
    });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request('service-secret', 'capture'))).status).toBe(403);
    expect((await POST(request('service-secret', 'queued-finalization'))).status).toBe(200);
  });

  it('fails closed and safely audits owner mismatch, inactivity, deletion, or lookup failure', async () => {
    mocks.getEffectiveCapabilities.mockRejectedValue(new Error('Practitioner is not active'));

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
  ])('denies a session outside the active live lifecycle (%o)', async (sessionState) => {
    mocks.sessionFindUnique.mockResolvedValue({
      psychologistId: PSYCHOLOGIST_ID,
      ...sessionState,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('keeps the denial response authoritative when denial auditing is unavailable', async () => {
    mocks.getEffectiveCapabilities.mockRejectedValue(new Error('Practitioner is not active'));
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

  it.each(['preflight', 'capture-activation'] as const)(
    'requires the service secret before the %s handshake',
    async (purpose) => {
      expect((await POST(request('wrong', purpose))).status).toBe(401);
      expect(mocks.prepareCapture).not.toHaveBeenCalled();
      expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['preflight', 'capture-activation'] as const)(
    'routes %s through the locked consent and first-frame verifier',
    async (purpose) => {
      const response = await POST(request('service-secret', purpose));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        authorized: true,
        capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'],
      });
      expect(mocks.prepareCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          psychologistId: PSYCHOLOGIST_ID,
          vertical: 'DOCTOR',
          purpose,
        }),
      );
      expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['preflight', 'capture-activation'] as const)(
    'fails closed on rejected %s without falling back to the legacy verifier',
    async (purpose) => {
      mocks.prepareCapture.mockRejectedValue(new Error('Current consent or access denied'));
      mocks.writeAudit.mockRejectedValue(new Error('Audit unavailable'));
      const response = await POST(request('service-secret', purpose));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ authorized: false, capabilities: [] });
      expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
    },
  );

  it('permits readiness output for a scheduled Scribe session only through read-only preflight', async () => {
    mocks.sessionFindUnique.mockResolvedValue({
      psychologistId: PSYCHOLOGIST_ID,
      status: 'SCHEDULED',
      captureMode: 'LIVE',
      clientId: 'c987654321098765432109876',
      psychologist: { vertical: 'DOCTOR' },
    });
    expect((await POST(request('service-secret', 'queued-finalization'))).status).toBe(200);
    expect(mocks.prepareCapture).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'preflight' }),
    );
    mocks.prepareCapture.mockClear();
    expect((await POST(request('service-secret', 'capture'))).status).toBe(403);
    expect(mocks.prepareCapture).not.toHaveBeenCalled();
  });
});
