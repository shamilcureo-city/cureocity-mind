import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  identity: vi.fn(),
  capability: vi.fn(),
  lock: vi.fn(),
  usage: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: m.identity,
  requireCapability: m.capability,
}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./phi-write-lock', async (original) => ({
  ...(await original<typeof import('./phi-write-lock')>()),
  withActiveSessionPhiWrite: m.lock,
}));
vi.mock('./session-usage', async (original) => ({
  ...(await original<typeof import('./session-usage')>()),
  loadRecordedUsage: m.usage,
}));
import { GET } from '../app/api/v1/sessions/[id]/usage/route';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';
const request = () => new Request('https://example.test/api/v1/sessions/visit-1/usage') as never;
const read = () => GET(request(), { params: Promise.resolve({ id: 'visit-1' }) });
beforeEach(() => {
  vi.resetAllMocks();
  const auth = { ok: true, value: { psychologistId: 'owner-1', user: { vertical: 'THERAPIST' } } };
  m.identity.mockResolvedValue(auth);
  m.capability.mockResolvedValue(auth);
  m.lock.mockImplementation(async (_db, _session, _owner, callback) => callback({}));
  m.usage.mockResolvedValue({ calls: [], connections: [], storageAvailable: true });
});
describe('owned session usage read', () => {
  it.each([401, 403])(
    'preserves %s authentication refusal privately without reading storage',
    async (status) => {
      m.identity.mockResolvedValue({
        ok: false,
        response: Response.json({ error: 'denied' }, { status }),
      });
      const response = await read();
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(m.usage).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['THERAPIST', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
    ['DOCTOR', 'MEDICAL_DOCUMENTATION'],
  ])('refreshes %s documentation capability', async (vertical, capability) => {
    const auth = { ok: true, value: { psychologistId: 'owner-1', user: { vertical } } };
    m.identity.mockResolvedValue(auth);
    m.capability.mockResolvedValue(auth);
    const response = await read();
    expect(response.status).toBe(200);
    expect(m.capability).toHaveBeenCalledWith(expect.anything(), capability, auth);
    expect(m.lock).toHaveBeenCalledWith(
      expect.anything(),
      'visit-1',
      'owner-1',
      expect.any(Function),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).recordedSubtotalInr).toBeNull();
  });
  it('refuses revoked documentation capability before reading linked records', async () => {
    m.capability.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'denied' }, { status: 403 }),
    });
    expect((await read()).status).toBe(403);
    expect(m.usage).not.toHaveBeenCalled();
  });
  it('hides cross-tenant and erased sessions with the same 404', async () => {
    m.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    expect((await read()).status).toBe(404);
    expect(m.usage).not.toHaveBeenCalled();
  });
  it('remains readable with reporting disabled and distinguishes missing table from failed read', async () => {
    vi.stubEnv('SESSION_USAGE_RECEIPTS_ENABLED', 'false');
    m.usage.mockResolvedValue({ calls: [], connections: [], storageAvailable: false });
    expect((await read()).status).toBe(200);
    m.usage.mockRejectedValue(new Error('secret database connection failure'));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
    vi.unstubAllEnvs();
  });
});
