import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  firebaseAuth: vi.fn<() => unknown>(() => null),
  getEffectiveCapabilities: vi.fn(),
  psychologistFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./firebase-admin', () => ({ firebaseAuth: mocks.firebaseAuth }));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: mocks.psychologistFindUnique },
    client: { findUnique: mocks.clientFindUnique },
  },
}));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
  serializeCapabilities: (effective: { capabilities: Set<string> }) =>
    [...effective.capabilities].sort(),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-only' }),
  writeAudit: mocks.writeAudit,
}));

import {
  isAuthBypassed,
  requireAdmin,
  requireCapability,
  requirePsychologistId,
  resolveClient,
  resolvePsychologist,
} from './auth-server';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientFindUnique.mockResolvedValue(null);
});
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

  it('returns 503 at the request boundary when production Firebase Admin is unavailable', async () => {
    process.env = {
      ...originalEnv,
      AUTH_BYPASS: 'true',
      NODE_ENV: 'production',
    };
    delete process.env['VERCEL_ENV'];
    mocks.firebaseAuth.mockReturnValue(null);

    const auth = await requirePsychologistId(
      new Request('https://example.test/api/v1/sessions', { method: 'GET' }) as never,
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(503);
    expect(mocks.psychologistFindUnique).not.toHaveBeenCalled();
  });
});

describe('practitioner state boundary', () => {
  it('rejects a legacy UID linked to both practitioner and client roles', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
    mocks.psychologistFindUnique.mockResolvedValue({
      id: 'psy-1',
      role: 'THERAPIST',
      vertical: 'THERAPIST',
      deletedAt: null,
      status: 'ACTIVE',
    });
    mocks.clientFindUnique.mockResolvedValue({ id: 'client-1' });

    const resolved = await resolvePsychologist(
      new Request('https://example.test/api/v1/sessions') as never,
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.response.status).toBe(403);
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('rejects a client resolver UID also linked to a practitioner', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
    mocks.psychologistFindUnique.mockResolvedValue({ id: 'psy-1' });
    mocks.clientFindUnique.mockResolvedValue({ id: 'client-1' });

    const resolved = await resolveClient(
      new Request('https://example.test/api/v1/p/home') as never,
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.response.status).toBe(403);
  });

  it.each([
    { status: 'PENDING_VERIFICATION', deletedAt: null },
    { status: 'SUSPENDED', deletedAt: null },
    { status: 'OFFBOARDED', deletedAt: null },
    { status: 'ACTIVE', deletedAt: new Date('2026-01-01T00:00:00.000Z') },
  ] as const)(
    'rejects unavailable practitioner state %# before resolving grants',
    async (state) => {
      process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
      mocks.psychologistFindUnique.mockResolvedValue({
        id: 'psy-1',
        role: 'THERAPIST',
        vertical: 'THERAPIST',
        ...state,
      });

      const resolved = await resolvePsychologist(
        new Request('https://example.test/api/v1/sessions') as never,
      );

      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.response.status).toBe(403);
      expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
    },
  );
});

describe('regulated route boundary', () => {
  it.each([
    ['absent', []],
    ['revoked', []],
  ] as const)(
    'denies signed-note search when documentation authority is %s',
    async (_state, caps) => {
      process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
      mocks.psychologistFindUnique.mockResolvedValue({
        id: 'psy-1',
        role: 'THERAPIST',
        vertical: 'THERAPIST',
        deletedAt: null,
        status: 'ACTIVE',
      });
      mocks.getEffectiveCapabilities.mockResolvedValue({
        profession: 'CLINICAL_PSYCHOLOGIST',
        capabilities: new Set(caps),
        verifiedCredentialKinds: new Set(),
      });

      const auth = await requirePsychologistId(
        new Request('https://example.test/api/v1/search/notes?q=sleep', { method: 'GET' }) as never,
      );

      expect(auth.ok).toBe(false);
      if (!auth.ok) expect(auth.response.status).toBe(403);
      expect(mocks.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CAPABILITY_ACCESS_DENIED',
          targetId: 'BEHAVIORAL_HEALTH_DOCUMENTATION',
        }),
      );
    },
  );

  it('fails closed even when denial audit persistence is unavailable', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'true' };
    mocks.psychologistFindUnique.mockResolvedValue({
      id: 'psy-1',
      role: 'THERAPIST',
      vertical: 'THERAPIST',
      deletedAt: null,
      status: 'ACTIVE',
    });
    mocks.getEffectiveCapabilities.mockResolvedValue({
      profession: 'CLINICAL_PSYCHOLOGIST',
      capabilities: new Set(),
      verifiedCredentialKinds: new Set(),
    });
    mocks.writeAudit.mockRejectedValueOnce(new Error('audit storage unavailable'));

    const auth = await requirePsychologistId(
      new Request('https://example.test/api/v1/search/notes', { method: 'GET' }) as never,
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
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

describe('cookie-authenticated mutation origin boundary', () => {
  const activePractitioner = {
    id: 'psy-1',
    role: 'ADMIN',
    vertical: 'THERAPIST',
    deletedAt: null,
    status: 'ACTIVE',
  };
  const grants = {
    profession: 'CLINICAL_PSYCHOLOGIST',
    capabilities: new Set(['THERAPY_WORKFLOWS']),
    verifiedCredentialKinds: new Set(),
  };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', AUTH_BYPASS: 'false' };
    mocks.firebaseAuth.mockReturnValue({
      verifySessionCookie: vi.fn(async () => ({ uid: 'uid-cookie' })),
      verifyIdToken: vi.fn(async () => ({ uid: 'uid-bearer' })),
    });
    mocks.psychologistFindUnique.mockResolvedValue(activePractitioner);
    mocks.clientFindUnique.mockResolvedValue(null);
    mocks.getEffectiveCapabilities.mockResolvedValue(grants);
  });

  it('rejects a sibling-origin practitioner clinical mutation before resolving grants', async () => {
    const req = new NextRequest('https://mind.cureocity.in/api/v1/assignments', {
      method: 'POST',
      headers: {
        cookie: '__session=session-cookie',
        origin: 'https://admin.cureocity.in',
        'sec-fetch-site': 'same-site',
      },
    });

    const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
    expect(mocks.psychologistFindUnique).not.toHaveBeenCalled();
    expect(mocks.getEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('rejects an admin cookie mutation when browser origin signals are absent', async () => {
    const req = new NextRequest('https://admin.cureocity.in/api/v1/admin/invite-codes', {
      method: 'POST',
      headers: { cookie: '__session=session-cookie' },
    });

    const auth = await requireAdmin(req);

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
    expect(mocks.psychologistFindUnique).not.toHaveBeenCalled();
  });

  it('accepts a same-origin cookie mutation and bearer mutation without browser signals', async () => {
    const cookie = await requireCapability(
      new NextRequest('https://mind.cureocity.in/api/v1/assignments', {
        method: 'POST',
        headers: {
          cookie: '__session=session-cookie',
          origin: 'https://mind.cureocity.in',
          'sec-fetch-site': 'same-origin',
        },
      }),
      'THERAPY_WORKFLOWS',
    );
    const bearer = await requireAdmin(
      new NextRequest('https://admin.cureocity.in/api/v1/admin/invite-codes', {
        method: 'POST',
        headers: { authorization: 'Bearer server-token' },
      }),
    );

    expect(cookie.ok).toBe(true);
    expect(bearer.ok).toBe(true);
  });
});
