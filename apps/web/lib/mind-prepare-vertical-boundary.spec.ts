import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  requireCapability: vi.fn(),
  clientFindUnique: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.clientFindUnique },
  },
}));
vi.mock('./journey', () => ({
  JourneyError: class JourneyError extends Error {},
  computeClientJourney: vi.fn(),
}));
vi.mock('./case-briefing', () => ({ gatherInputs: vi.fn(), serialiseContext: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPreSessionBrief: vi.fn() }));
vi.mock('./crisis-flags', () => ({ fetchOpenCrises: vi.fn() }));
vi.mock('./llm', () => ({ modelRouter: vi.fn() }));

import { GET as getPrepare } from '../app/api/v1/clients/[id]/prepare/route';
import { GET as getPreSessionBrief } from '../app/api/v1/clients/[id]/pre-session-brief/route';

const context = { params: Promise.resolve({ id: 'client-1' }) };
const doctorAuth = {
  ok: true,
  value: {
    psychologistId: 'doctor-1',
    user: { vertical: 'DOCTOR' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue(doctorAuth);
  mocks.requireCapability.mockResolvedValue(doctorAuth);
  mocks.clientFindUnique.mockResolvedValue(null);
});

describe('Mind preparation API vertical boundary', () => {
  it.each([
    [
      'prepare',
      () =>
        getPrepare(
          new Request('https://example.test/api/v1/clients/client-1/prepare') as never,
          context,
        ),
    ],
    [
      'pre-session brief',
      () =>
        getPreSessionBrief(
          new Request(
            'https://example.test/api/v1/clients/client-1/pre-session-brief?refresh=1',
          ) as never,
          context,
        ),
    ],
  ])('rejects a Doctor before the %s route reads client data', async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});
