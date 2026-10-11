import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  verifySessionCookie: vi.fn(),
  psychologist: vi.fn(),
  client: vi.fn(),
  capabilities: vi.fn(),
  audit: vi.fn(),
  manualBoundary: vi.fn(),
}));

vi.mock('./firebase-admin', () => ({
  firebaseAuth: () => ({
    verifyIdToken: mocks.verifyIdToken,
    verifySessionCookie: mocks.verifySessionCookie,
  }),
}));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: mocks.psychologist },
    client: { findUnique: mocks.client },
  },
}));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: mocks.capabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./mind-manual-boundary', () => ({ enforceManualSessionBoundary: mocks.manualBoundary }));

import {
  requirePsychologistId,
  resolveClient,
  resolveFirebaseUidOnly,
  resolveFirebaseClaimIdentity,
} from './auth-server';

const doctorUid = 'fictional-doctor-uid';
const therapistUid = 'fictional-therapist-uid';
const mismatchBody = {
  error: 'Your sign-in changed. Sign in again to continue with one account.',
  code: 'SESSION_IDENTITY_MISMATCH',
};

function request({
  bearer,
  cookie,
  expectedUid,
  host = 'scribe.cureocity.in',
  path = '/api/v1/scribe-tasks',
}: {
  bearer?: string;
  cookie?: string;
  expectedUid?: string;
  host?: string;
  path?: string;
} = {}) {
  const headers = new Headers();
  if (bearer !== undefined) headers.set('authorization', bearer);
  if (cookie !== undefined) headers.set('cookie', `__session=${cookie}`);
  if (expectedUid !== undefined) headers.set('x-cureocity-session-uid', expectedUid);
  return new NextRequest(`https://${host}${path}`, { headers });
}

function expectNoAuthorityLookup() {
  expect(mocks.psychologist).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.capabilities).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.manualBoundary).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('AUTH_BYPASS', 'false');
  mocks.verifyIdToken.mockResolvedValue({ uid: doctorUid });
  mocks.verifySessionCookie.mockResolvedValue({ uid: doctorUid });
  mocks.psychologist.mockImplementation(async ({ where }: { where: { firebaseUid: string } }) => ({
    id: `practitioner-${where.firebaseUid}`,
    role: 'THERAPIST',
    vertical: where.firebaseUid === therapistUid ? 'THERAPIST' : 'DOCTOR',
    deletedAt: null,
    status: 'ACTIVE',
  }));
  mocks.client.mockResolvedValue(null);
  mocks.capabilities.mockResolvedValue({
    capabilities: new Set(['MEDICAL_DOCUMENTATION', 'BEHAVIORAL_HEALTH_DOCUMENTATION']),
    verifiedCredentialKinds: new Set(),
    profession: null,
  });
  mocks.manualBoundary.mockResolvedValue(null);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verified request identity consistency', () => {
  it.each(['auth/id-token-revoked', 'auth/user-disabled'])(
    'rejects %s before practitioner lookup without retry or cookie fallback',
    async (code) => {
      mocks.verifyIdToken.mockImplementation(async (_token, checkRevoked) => {
        if (checkRevoked) throw { code };
        return { uid: doctorUid };
      });
      const result = await requirePsychologistId(
        request({ bearer: 'Bearer revoked', cookie: 'valid' }),
      );
      expect(result.ok).toBe(false);
      expect(mocks.verifyIdToken).toHaveBeenCalledOnce();
      expect(mocks.verifyIdToken).toHaveBeenCalledWith('revoked', true);
      expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
      expectNoAuthorityLookup();
    },
  );

  it('rejects revoked cookies even when a matching bearer verifies', async () => {
    mocks.verifySessionCookie.mockImplementation(async (_token, checkRevoked) => {
      if (checkRevoked) throw { code: 'auth/session-cookie-revoked' };
      return { uid: doctorUid };
    });
    const result = await requirePsychologistId(
      request({ bearer: 'Bearer valid', cookie: 'revoked' }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.verifySessionCookie).toHaveBeenCalledOnce();
    expectNoAuthorityLookup();
  });

  it('keeps revocation enabled through transient verification retries', async () => {
    mocks.verifySessionCookie.mockRejectedValueOnce({ code: 'auth/internal-error' });
    const result = await requirePsychologistId(request({ cookie: 'valid' }));
    expect(result.ok).toBe(true);
    expect(mocks.verifySessionCookie.mock.calls).toEqual([
      ['valid', true],
      ['valid', true],
    ]);
  });

  it('also checks revocation before redeeming a client identity claim', async () => {
    mocks.verifyIdToken.mockRejectedValue({ code: 'auth/user-disabled' });
    const result = await resolveFirebaseClaimIdentity(request({ bearer: 'Bearer disabled' }));
    expect(result.ok).toBe(false);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('disabled', true);
    expect(mocks.verifyIdToken).toHaveBeenCalledOnce();
  });

  it.each([
    ['scribe.cureocity.in', doctorUid, therapistUid],
    ['mind.cureocity.in', therapistUid, doctorUid],
  ])(
    'rejects the %s page/API account split before any account or capability lookup',
    async (host, cookieUid, bearerUid) => {
      mocks.verifyIdToken.mockResolvedValue({ uid: bearerUid });
      mocks.verifySessionCookie.mockResolvedValue({ uid: cookieUid });
      const result = await requirePsychologistId(
        request({ host, bearer: 'Bearer private-bearer', cookie: 'private-cookie' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected a consistency denial');
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get('cache-control')).toBe('private, no-store');
      expect(await result.response.json()).toEqual(mismatchBody);
      expect(mocks.verifyIdToken).toHaveBeenCalledWith('private-bearer', true);
      expect(mocks.verifySessionCookie).toHaveBeenCalledWith('private-cookie', true);
      expectNoAuthorityLookup();
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it.each([doctorUid, therapistUid])('accepts matching dual credentials for %s', async (uid) => {
    mocks.verifyIdToken.mockResolvedValue({ uid });
    mocks.verifySessionCookie.mockResolvedValue({ uid });
    const result = await requirePsychologistId(
      request({ bearer: 'Bearer matching-bearer', cookie: 'matching-cookie', expectedUid: uid }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { psychologistId: `practitioner-${uid}`, user: { firebaseUid: uid } },
    });
    expect(mocks.verifyIdToken).toHaveBeenCalledOnce();
    expect(mocks.verifySessionCookie).toHaveBeenCalledOnce();
  });

  it.each(['cookie', 'bearer'] as const)('preserves %s-only authentication', async (kind) => {
    const result = await requirePsychologistId(
      request(kind === 'cookie' ? { cookie: 'cookie-only' } : { bearer: 'Bearer bearer-only' }),
    );
    expect(result).toMatchObject({ ok: true, value: { user: { firebaseUid: doctorUid } } });
    expect(mocks.verifyIdToken).toHaveBeenCalledTimes(kind === 'bearer' ? 1 : 0);
    expect(mocks.verifySessionCookie).toHaveBeenCalledTimes(kind === 'cookie' ? 1 : 0);
  });

  it('does not fall back to a valid cookie after an invalid supplied Bearer token', async () => {
    mocks.verifyIdToken.mockRejectedValue({
      code: 'auth/invalid-id-token',
      message: `Do not expose ${doctorUid} private-bearer private-cookie`,
    });
    const result = await requirePsychologistId(
      request({ bearer: 'Bearer private-bearer', cookie: 'private-cookie' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid credential denial');
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({
      error: 'Invalid token',
      code: 'SESSION_REAUTH_REQUIRED',
    });
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
    expectNoAuthorityLookup();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(doctorUid);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-bearer');
  });

  it('does not ignore an invalid cookie when the Bearer token verifies', async () => {
    mocks.verifySessionCookie.mockRejectedValue({ code: 'auth/session-cookie-expired' });
    const result = await requirePsychologistId(
      request({ bearer: 'Bearer private-bearer', cookie: 'expired-cookie' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid cookie denial');
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.response.json()).toEqual({
      error: 'Session expired — sign in again',
      code: 'SESSION_REAUTH_REQUIRED',
    });
    expect(mocks.verifyIdToken).toHaveBeenCalledOnce();
    expect(mocks.verifySessionCookie).toHaveBeenCalledOnce();
    expectNoAuthorityLookup();
  });

  it.each(['', 'Bearer', 'Basic supplied-credential'])(
    'does not ignore malformed Authorization %j in favor of the cookie',
    async (bearer) => {
      const result = await requirePsychologistId(request({ bearer, cookie: 'valid-cookie' }));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected malformed credential denial');
      expect(result.response.status).toBe(401);
      expect(mocks.verifyIdToken).not.toHaveBeenCalled();
      expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
      expectNoAuthorityLookup();
    },
  );

  it.each([
    { cookie: 'current-cookie' },
    { bearer: 'Bearer current-bearer' },
    { cookie: 'current-cookie', bearer: 'Bearer current-bearer' },
  ])('rejects a stale page assertion with credentials %o', async (credentials) => {
    const result = await requirePsychologistId(
      request({ ...credentials, expectedUid: therapistUid }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected stale-page denial');
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual(mismatchBody);
    expectNoAuthorityLookup();
  });

  it('does not treat the page assertion alone as authentication', async () => {
    const result = await requirePsychologistId(request({ expectedUid: doctorUid }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected missing credential denial');
    expect(result.response.status).toBe(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
    expectNoAuthorityLookup();
  });

  it('does not grant medical authority merely because the page assertion matches', async () => {
    mocks.capabilities.mockResolvedValue({
      capabilities: new Set(),
      verifiedCredentialKinds: new Set(),
    });
    const result = await requirePsychologistId(
      request({ bearer: 'Bearer valid-bearer', expectedUid: doctorUid }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected capability denial');
    expect(result.response.status).toBe(403);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CAPABILITY_ACCESS_DENIED',
        targetId: 'MEDICAL_DOCUMENTATION',
      }),
    );
  });

  it.each([resolveFirebaseUidOnly, resolveClient])(
    'also rejects mismatches at UID-only and patient identity entry points',
    async (resolve) => {
      mocks.verifySessionCookie.mockResolvedValue({ uid: therapistUid });
      const result = await resolve(
        request({ bearer: 'Bearer private-bearer', cookie: 'private-cookie' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected consistency denial');
      expect(await result.response.json()).toEqual(mismatchBody);
      expectNoAuthorityLookup();
    },
  );

  it('preserves the existing cookie mutation origin gate before credential verification', async () => {
    const result = await requirePsychologistId(
      new NextRequest('https://scribe.cureocity.in/api/v1/sessions', {
        method: 'POST',
        headers: {
          cookie: '__session=valid-cookie',
          origin: 'https://mind.cureocity.in',
          'sec-fetch-site': 'same-site',
          'x-cureocity-session-uid': doctorUid,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected same-origin denial');
    expect(result.response.status).toBe(403);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
    expectNoAuthorityLookup();
  });
});
