import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  getEffectiveCapabilities: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { session: { findUnique: mocks.sessionFindUnique } },
}));
vi.mock('@/lib/capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.writeAudit }));

import { POST } from '../app/api/v1/internal/live-authority/route';

const SESSION_ID = 'c123456789012345678901234';
const PSYCHOLOGIST_ID = 'cabcdefghijklmnopqrstuvwx';

const request = (secret = 'service-secret') =>
  new Request('https://web.internal/api/v1/internal/live-authority', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sessionId: SESSION_ID, psychologistId: PSYCHOLOGIST_ID }),
  }) as never;

describe('internal live authority verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['LIVE_GATEWAY_SECRET'] = 'service-secret';
    mocks.sessionFindUnique.mockResolvedValue({
      psychologistId: PSYCHOLOGIST_ID,
      status: 'IN_PROGRESS',
      captureMode: 'LIVE',
    });
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
});
