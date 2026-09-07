import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  guides: vi.fn(),
  defaults: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./load-prepared-mind-guides', () => ({ loadPreparedMindGuides: mocks.guides }));
vi.mock('./session-defaults', () => ({
  computeSessionDefaults: mocks.defaults,
  SessionDefaultsError: class extends Error {},
}));
import { GET } from '../app/api/v1/clients/[id]/session-defaults/route';
const get = (guides = true) =>
  GET(
    new NextRequest(
      `https://example.test/api/v1/clients/client-1/session-defaults${guides ? '?guides=1' : ''}`,
    ),
    { params: Promise.resolve({ id: 'client-1' }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  const auth = { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.guides.mockResolvedValue([
    {
      id: 'guide-1',
      body: { therapyName: 'Prepared guide', openingScript: 'Private text not disclosed here' },
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
  ]);
  mocks.defaults.mockResolvedValue({ kind: 'INTAKE' });
});
describe('optional prepared-guide choices at entry', () => {
  it('returns only cached choice metadata with no-store and workflow authority', async () => {
    const response = await get();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      guides: [{ id: 'guide-1', name: 'Prepared guide', updatedAt: '2026-09-07T10:00:00.000Z' }],
    });
    expect(mocks.capability).toHaveBeenCalledWith(
      expect.anything(),
      'THERAPY_WORKFLOWS',
      expect.anything(),
    );
    expect(mocks.guides).toHaveBeenCalledWith({
      clientId: 'client-1',
      psychologistId: 'psy-1',
      vertical: 'THERAPIST',
      capabilities: new Set(['THERAPY_WORKFLOWS']),
    });
  });
  it('does not let guide outages block ordinary capture defaults', async () => {
    mocks.guides.mockRejectedValue(new Error('Private backend message'));
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('Private backend');
    expect(await (await get(false)).json()).toEqual({ defaults: { kind: 'INTAKE' } });
  });
  it('rejects missing workflow authority before guide access', async () => {
    mocks.capability.mockResolvedValue({
      ok: false,
      response: new Response('{}', { status: 403 }),
    });
    expect((await get()).status).toBe(403);
    expect(mocks.guides).not.toHaveBeenCalled();
  });
  it('does not expose Mind guides to doctors', async () => {
    mocks.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await get()).status).toBe(404);
    expect(mocks.guides).not.toHaveBeenCalled();
  });
});
