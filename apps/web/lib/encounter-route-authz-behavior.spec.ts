import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  getEncounter: vi.fn(),
  createEncounter: vi.fn(),
  startEncounter: vi.fn(),
  completeEncounter: vi.fn(),
  noShowEncounter: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('../app/api/v1/sessions/route', () => ({ POST: mocks.createEncounter }));
vi.mock('../app/api/v1/sessions/[id]/route', () => ({ GET: mocks.getEncounter }));
vi.mock('../app/api/v1/sessions/[id]/start/route', () => ({ POST: mocks.startEncounter }));
vi.mock('../app/api/v1/sessions/[id]/end/route', () => ({ POST: mocks.completeEncounter }));
vi.mock('../app/api/v1/sessions/[id]/no-show/route', () => ({ POST: mocks.noShowEncounter }));

import { POST as createEncounter } from '../app/api/v1/encounters/route';
import { GET as getEncounter } from '../app/api/v1/encounters/[id]/route';
import { POST as startEncounter } from '../app/api/v1/encounters/[id]/start/route';
import { POST as completeEncounter } from '../app/api/v1/encounters/[id]/complete/route';
import { POST as noShowEncounter } from '../app/api/v1/encounters/[id]/no-show/route';

const denied = () => ({
  ok: false as const,
  response: new Response(JSON.stringify({ error: 'not authorized' }), { status: 403 }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue(denied());
});

describe('Encounter compatibility route authorization', () => {
  it.each([
    ['GET', getEncounter, mocks.getEncounter, '/api/v1/encounters/enc-1'],
    ['create', createEncounter, mocks.createEncounter, '/api/v1/encounters'],
    ['start', startEncounter, mocks.startEncounter, '/api/v1/encounters/enc-1/start'],
    ['complete', completeEncounter, mocks.completeEncounter, '/api/v1/encounters/enc-1/complete'],
    ['no-show', noShowEncounter, mocks.noShowEncounter, '/api/v1/encounters/enc-1/no-show'],
  ])(
    'denies absent or revoked LIVE_ENCOUNTER authority before the %s Session delegate',
    async (_label, handler, delegate, pathname) => {
      const request = new Request(`https://example.test${pathname}`, { method: 'POST' }) as never;
      const response = await handler(request, {
        params: Promise.resolve({ id: 'enc-1' }),
      } as never);

      expect(response.status).toBe(403);
      expect(mocks.requireCapability).toHaveBeenCalledWith(request, 'LIVE_ENCOUNTER');
      expect(delegate).not.toHaveBeenCalled();
    },
  );
});
