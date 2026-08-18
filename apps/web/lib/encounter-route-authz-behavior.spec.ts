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
});

type Handler = (request: never, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const routes = [
  {
    label: 'GET',
    handler: getEncounter as Handler,
    delegate: mocks.getEncounter,
    pathname: '/api/v1/encounters/enc-1',
    method: 'GET',
    capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'],
  },
  {
    label: 'create',
    handler: createEncounter as Handler,
    delegate: mocks.createEncounter,
    pathname: '/api/v1/encounters',
    method: 'POST',
    capabilities: ['LIVE_ENCOUNTER'],
  },
  {
    label: 'start',
    handler: startEncounter as Handler,
    delegate: mocks.startEncounter,
    pathname: '/api/v1/encounters/enc-1/start',
    method: 'POST',
    capabilities: ['LIVE_ENCOUNTER', 'AMBIENT_CAPTURE'],
  },
  {
    label: 'complete',
    handler: completeEncounter as Handler,
    delegate: mocks.completeEncounter,
    pathname: '/api/v1/encounters/enc-1/complete',
    method: 'POST',
    capabilities: ['LIVE_ENCOUNTER', 'AMBIENT_CAPTURE', 'MEDICAL_DOCUMENTATION'],
  },
  {
    label: 'no-show',
    handler: noShowEncounter as Handler,
    delegate: mocks.noShowEncounter,
    pathname: '/api/v1/encounters/enc-1/no-show',
    method: 'POST',
    capabilities: ['LIVE_ENCOUNTER'],
  },
] as const;

describe('Encounter compatibility route authorization', () => {
  for (const route of routes) {
    it.each(route.capabilities)(
      `denies missing %s before the ${route.label} Session delegate`,
      async (missing) => {
        const granted = {
          ok: true as const,
          value: { psychologistId: 'psy-1', user: { capabilities: route.capabilities } },
        };
        mocks.requireCapability.mockImplementation(async (_request, capability) =>
          capability === missing ? denied() : granted,
        );
        const request = new Request(`https://example.test${route.pathname}`, {
          method: route.method,
        }) as never;

        const response = await route.handler(request, {
          params: Promise.resolve({ id: 'enc-1' }),
        });

        expect(response.status).toBe(403);
        expect(
          mocks.requireCapability.mock.calls.some(
            ([calledRequest, capability]) => calledRequest === request && capability === missing,
          ),
        ).toBe(true);
        expect(route.delegate).not.toHaveBeenCalled();
      },
    );
  }
});
