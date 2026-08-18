import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firebaseAuth: vi.fn(() => null),
  getEffectiveCapabilities: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./firebase-admin', () => ({ firebaseAuth: mocks.firebaseAuth }));
vi.mock('./prisma', () => ({ prisma: { psychologist: { findUnique: vi.fn() } } }));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-only' }),
  writeAudit: mocks.writeAudit,
}));

import { isAuthBypassed, requireCapability } from './auth-server';

const originalEnv = { ...process.env };

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('authentication bypass boundary', () => {
  it.each([
    { NODE_ENV: 'production' as const, VERCEL_ENV: undefined },
    { NODE_ENV: 'test' as const, VERCEL_ENV: 'production' },
  ])('ignores AUTH_BYPASS in production (%o)', (environment) => {
    process.env = Object.fromEntries(
      Object.entries({ ...originalEnv, AUTH_BYPASS: 'true', ...environment }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ) as NodeJS.ProcessEnv;
    expect(isAuthBypassed()).toBe(false);
  });

  it.each(['development', 'test'] as const)('permits explicit bypass in %s', (NODE_ENV) => {
    process.env = { ...originalEnv, AUTH_BYPASS: 'true', NODE_ENV, VERCEL_ENV: 'preview' };
    expect(isAuthBypassed()).toBe(true);
  });
});

describe('capability denial', () => {
  it('returns 403 and audits only practitioner and capability identifiers', async () => {
    mocks.getEffectiveCapabilities.mockResolvedValue({ capabilities: new Set() });
    const req = new Request('https://example.test/api/v1/share', {
      headers: { authorization: 'Bearer token' },
    });
    const auth = await requireCapability(req as never, 'PATIENT_SHARING', {
      ok: true,
      value: {
        psychologistId: 'psy-1',
        user: { firebaseUid: 'uid', psychologistId: 'psy-1', capabilities: [] },
      },
    });

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorPsychologistId: 'psy-1',
        action: 'CAPABILITY_ACCESS_DENIED',
        targetType: 'PractitionerCapability',
        targetId: 'PATIENT_SHARING',
        metadata: { requestId: 'request-only' },
      }),
    );
  });

  it('rechecks current grants and denies a capability revoked after identity resolution', async () => {
    mocks.getEffectiveCapabilities.mockResolvedValue({
      profession: 'PHYSICIAN',
      capabilities: new Set(),
      verifiedCredentialKinds: new Set(),
    });
    const req = new Request('https://example.test/api/v1/share');

    const auth = await requireCapability(req as never, 'PATIENT_SHARING', {
      ok: true,
      value: {
        psychologistId: 'psy-1',
        user: {
          firebaseUid: 'uid',
          psychologistId: 'psy-1',
          capabilities: ['PATIENT_SHARING'],
        },
      },
    });

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
    expect(mocks.getEffectiveCapabilities).toHaveBeenCalledWith('psy-1');
    expect(mocks.writeAudit).toHaveBeenCalledOnce();
  });
});
