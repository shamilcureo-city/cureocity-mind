import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { SCRIBE_CONSENT_SCOPES } from './consent-gate';
import { REGULATED_ROUTE_CAPABILITIES } from './regulated-route-capabilities';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  session: vi.fn(),
  consent: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: mocks.auth }));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
import { POST } from '../app/api/v1/sessions/[id]/capture-resume/route';
const run = () =>
  POST(
    new NextRequest('https://example.test/api/v1/sessions/session-1/capture-resume', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'session-1' }) },
  );
const session = () => ({
  clientId: 'client-1',
  psychologistId: 'psy-1',
  status: 'IN_PROGRESS',
  psychologist: { vertical: 'THERAPIST', status: 'ACTIVE', deletedAt: null },
  consentSnapshot: { entries: SCRIBE_CONSENT_SCOPES.map((scope) => ({ scope })) },
});
const grants = () =>
  SCRIBE_CONSENT_SCOPES.map((scope) => ({
    scope,
    status: 'GRANTED',
    withdrawnAt: null,
    expiresAt: null,
  }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  mocks.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  mocks.session.mockResolvedValue(session());
  mocks.consent.mockResolvedValue(grants());
  // No writer methods exist: a lifecycle/draft mutation fails this test.
  mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) =>
    work({
      $queryRaw: mocks.query,
      session: { findUnique: mocks.session },
      consent: { findMany: mocks.consent },
    }),
  );
});
describe('Mind paused capture reauthorization', () => {
  it('checks fresh consent under the active-client lock and returns no clinical data or lifecycle write', async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authorized: true });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.query.mock.calls[0]?.[0].join('?')).toContain('FOR UPDATE OF c');
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.session.mock.invocationCallOrder[0]!,
    );
    expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.consent.mock.invocationCallOrder[0]!,
    );
  });
  it.each(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'never reopens a %s session',
    async (status) => {
      mocks.session.mockResolvedValue({ ...session(), status });
      expect((await run()).status).toBe(409);
      expect(mocks.consent).not.toHaveBeenCalled();
    },
  );
  it('denies erased clients and mismatched tenant/client linkage without checking consent', async () => {
    for (const row of [
      null,
      { ...session(), psychologistId: 'other' },
      { ...session(), clientId: 'other' },
      { ...session(), psychologist: { vertical: 'DOCTOR', status: 'ACTIVE', deletedAt: null } },
    ]) {
      mocks.session.mockResolvedValue(row);
      expect((await run()).status).toBe(404);
    }
    mocks.query.mockResolvedValue([]);
    expect((await run()).status).toBe(404);
    expect(mocks.consent).not.toHaveBeenCalled();
  });
  it('rejects expired, withdrawn, missing standing consent and missing snapshots using the real consent gate', async () => {
    for (const rows of [
      [],
      grants().map((row) => ({ ...row, status: 'WITHDRAWN', withdrawnAt: new Date() })),
      grants().map((row) => ({ ...row, expiresAt: new Date(0) })),
    ]) {
      mocks.consent.mockResolvedValue(rows);
      const response = await run();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    }
    mocks.consent.mockResolvedValue(grants());
    mocks.session.mockResolvedValue({ ...session(), consentSnapshot: null });
    expect((await run()).status).toBe(409);
  });
  it('requires both documentation and capture authority, rejecting missing authority before DB work', async () => {
    expect(
      REGULATED_ROUTE_CAPABILITIES.find((entry) => entry.route.endsWith('/capture-resume'))
        ?.requirements,
    ).toEqual(['BEHAVIORAL_HEALTH_DOCUMENTATION', 'AMBIENT_CAPTURE']);
    mocks.auth.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    const response = await run();
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects a doctor before touching any session and fails closed on backend failure', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await run()).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.query.mockRejectedValue(new Error('Sensitive backend diagnostics'));
    const response = await run();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('Sensitive backend');
  });
});
