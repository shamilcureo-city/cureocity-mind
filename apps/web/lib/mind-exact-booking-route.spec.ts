import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  client: vi.fn(),
  session: vi.fn(),
  candidates: vi.fn(),
  transaction: vi.fn(),
  defaults: vi.fn(),
  billing: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.client },
    session: { findFirst: mocks.session, findMany: mocks.candidates },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./billing', () => ({ getEntitlement: mocks.billing, isBillingEnforced: () => true }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: vi.fn() }));
vi.mock('./mappers', () => ({ toSession: (row: unknown) => row }));
vi.mock('./session-defaults', () => ({
  computeSessionDefaults: mocks.defaults,
  modalityWasOverridden: vi.fn(),
  SessionDefaultsError: class extends Error {},
}));
vi.mock('./clinic-queue', () => ({ istDayRange: vi.fn(), nextClinicToken: vi.fn() }));
import { POST } from '../app/api/v1/sessions/route';

const CLIENT = 'cm00000000000000000000001';
const SESSION = 'cm00000000000000000000002';
const call = (extra = {}) =>
  POST(
    new NextRequest('https://example.test/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT,
        expectedSessionId: SESSION,
        scheduledAt: '2099-09-07T10:00:00.000Z',
        startNow: true,
        ...extra,
      }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  const auth = { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.client.mockResolvedValue({ id: CLIENT, psychologistId: 'psy-1', deletedAt: null });
  mocks.session.mockResolvedValue({ id: SESSION, clientId: CLIENT, status: 'SCHEDULED' });
});
describe('exact Mind booking selection never creates a replacement', () => {
  it.each(['SCHEDULED', 'IN_PROGRESS'])(
    'returns an owned %s booking before billing or generic reuse',
    async (status) => {
      mocks.session.mockResolvedValue({ id: SESSION, clientId: CLIENT, status });
      const response = await call();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: SESSION, clientId: CLIENT });
      expect(mocks.session).toHaveBeenCalledWith({
        where: {
          id: SESSION,
          clientId: CLIENT,
          psychologistId: 'psy-1',
          client: { deletedAt: null, psychologistId: 'psy-1' },
        },
      });
      expect(mocks.candidates).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.billing).not.toHaveBeenCalled();
      expect(mocks.defaults).not.toHaveBeenCalled();
    },
  );
  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'rejects a %s booking without mutation',
    async (status) => {
      mocks.session.mockResolvedValue({ id: SESSION, status });
      expect((await call()).status).toBe(409);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it('does not fall back to creating when the booking belongs to another client/tenant or is absent', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects erased clients, doctor context and missing authority before booking lookup', async () => {
    mocks.client.mockResolvedValue({ deletedAt: new Date(), psychologistId: 'psy-1' });
    expect((await call()).status).toBe(404);
    mocks.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await call()).status).toBe(404);
    mocks.auth.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) });
    expect((await call()).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('rejects missing capability and contradictory create intent before looking up a booking', async () => {
    expect((await call({ startNow: false })).status).toBe(400);
    expect((await call({ sourceSessionId: SESSION })).status).toBe(400);
    mocks.capability.mockResolvedValue({
      ok: false,
      response: new Response('{}', { status: 403 }),
    });
    expect((await call()).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
