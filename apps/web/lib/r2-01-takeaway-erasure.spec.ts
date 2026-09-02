import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  parseJson: vi.fn(),
  sessionFindFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  closeoutUpsert: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findFirst: mocks.sessionFindFirst },
    exerciseAssignment: { findFirst: vi.fn(async () => null) },
    treatmentPlan: { findFirst: vi.fn(async () => null) },
    $transaction: mocks.transaction,
  },
}));

import { GET as mindShareOptions } from '../app/api/v1/sessions/[id]/mind-share-options/route';
import { PUT as patientTakeaway } from '../app/api/v1/sessions/[id]/patient-takeaway/route';
import { DPDP_ERASURE_MANIFEST } from './dpdp-erasure-manifest';
import { eraseClientPhi } from './dpdp-erasure';

const activeSession = {
  id: 'session-1',
  clientId: 'client-1',
  psychologistId: 'therapist-1',
  status: 'COMPLETED',
  kind: 'TREATMENT',
  mindCloseout: { patientTakeaway: 'Use the private grounding narrative.' },
  therapyNote: { locked: true },
};

function request(path: string, method: 'GET' | 'PUT', body?: unknown) {
  return new Request(`https://mind.example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

function hasActiveClientGuard(where: unknown): boolean {
  const client = (where as { client?: { is?: { deletedAt?: unknown; status?: unknown } } })?.client
    ?.is;
  return client?.deletedAt === null && client.status === 'ACTIVE';
}

function routeTx() {
  return {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    session: { findFirst: mocks.sessionFindFirst },
    mindSessionCloseoutState: { upsert: mocks.closeoutUpsert },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockImplementation(
    async (_request, _capability, priorAuth) =>
      priorAuth ?? {
        ok: true,
        value: {
          psychologistId: 'therapist-1',
          user: {
            vertical: 'THERAPIST',
            capabilities: ['PATIENT_SHARING', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
          },
        },
      },
  );
  mocks.parseJson.mockResolvedValue({
    ok: true,
    value: { summary: 'A new private takeaway after erasure.' },
  });
  mocks.transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof routeTx>) => unknown) => callback(routeTx()),
  );
  mocks.executeRaw.mockResolvedValue(0);
  mocks.queryRaw.mockResolvedValue([{ id: 'client-1', psychologistId: 'therapist-1' }]);
  mocks.closeoutUpsert.mockResolvedValue({});
  mocks.writeAudit.mockResolvedValue(undefined);
});

describe('R2-01 patient takeaway erasure boundary', () => {
  it('redacts only patientTakeaway while retaining non-PHI closeout completion proof', async () => {
    const closeoutUpdates: unknown[] = [];
    const tx = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === '$queryRaw') {
            return vi.fn(async (strings: TemplateStringsArray) =>
              Array.from(strings).join('?').includes('to_regclass') ? [{ exists: false }] : [],
            );
          }
          if (property === '$executeRaw') return vi.fn(async () => 0);
          return new Proxy(
            {},
            {
              get: (_model, operation: string) =>
                vi.fn(async (args?: unknown) => {
                  if (property === 'session' && operation === 'findMany') {
                    return [{ id: 'session-1' }];
                  }
                  if (
                    (property === 'therapyNote' || property === 'audioChunk') &&
                    operation === 'findMany'
                  ) {
                    return [];
                  }
                  if (property === 'clientErasureRequest' && operation === 'findMany') return [];
                  if (property === 'patientShare' && operation === 'findFirst') return null;
                  if (property === 'mindSessionCloseoutState' && operation === 'updateMany') {
                    closeoutUpdates.push(args);
                  }
                  if (operation === 'deleteMany' || operation === 'updateMany') return { count: 0 };
                  return undefined;
                }),
            },
          );
        },
      },
    );

    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'therapist-1',
      now: new Date('2026-09-02T12:00:00.000Z'),
    });

    expect(closeoutUpdates).toEqual([
      {
        where: { sessionId: { in: ['session-1'] } },
        data: { patientTakeaway: null },
      },
    ]);
    expect(DPDP_ERASURE_MANIFEST.MindSessionCloseoutState).toMatchObject({
      disposition: 'REDACT',
      operation: expect.stringContaining('retain non-PHI closeout completion evidence'),
    });
  });

  it('GET cannot return a retained takeaway for a deleted client', async () => {
    mocks.sessionFindFirst.mockImplementation(async ({ where }) =>
      hasActiveClientGuard(where) ? null : activeSession,
    );

    const response = await mindShareOptions(
      request('/api/v1/sessions/session-1/mind-share-options', 'GET'),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Session not found' });
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          client: { is: { deletedAt: null, status: 'ACTIVE' } },
        }),
      }),
    );
  });

  it('PUT cannot recreate a takeaway after client erasure', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.sessionFindFirst.mockResolvedValue(activeSession);

    const response = await patientTakeaway(
      request('/api/v1/sessions/session-1/patient-takeaway', 'PUT', {
        summary: 'Recreated PHI',
      }),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
    expect(mocks.closeoutUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('PUT loses a race to erasure before revalidation, update, and audit', async () => {
    const events: string[] = [];
    mocks.queryRaw.mockImplementation(async () => {
      events.push('client-row-lock-after-erasure');
      return [];
    });
    mocks.executeRaw.mockImplementation(async () => {
      events.push('session-advisory-lock');
      return 0;
    });
    mocks.sessionFindFirst.mockImplementation(async () => {
      events.push('session-revalidation');
      return activeSession;
    });
    mocks.closeoutUpsert.mockImplementation(async () => {
      events.push('takeaway-update');
      return {};
    });
    mocks.writeAudit.mockImplementation(async () => {
      events.push('audit');
    });

    const response = await patientTakeaway(
      request('/api/v1/sessions/session-1/patient-takeaway', 'PUT', {
        summary: 'Race loser PHI',
      }),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(404);
    expect(events).toEqual(['client-row-lock-after-erasure']);
  });

  it('PUT locks the Client before active ownership revalidation, update, and audit', async () => {
    const events: string[] = [];
    mocks.queryRaw.mockImplementation(async () => {
      events.push('client-row-lock');
      return [{ id: 'client-1', psychologistId: 'therapist-1' }];
    });
    mocks.sessionFindFirst.mockImplementation(async ({ where }) => {
      events.push('active-session-revalidation');
      return hasActiveClientGuard(where) ? activeSession : null;
    });
    mocks.closeoutUpsert.mockImplementation(async () => {
      events.push('takeaway-update');
      return {};
    });
    mocks.writeAudit.mockImplementation(async () => {
      events.push('audit');
    });

    const response = await patientTakeaway(
      request('/api/v1/sessions/session-1/patient-takeaway', 'PUT', {
        summary: 'Allowed takeaway',
      }),
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      'client-row-lock',
      'active-session-revalidation',
      'takeaway-update',
      'audit',
    ]);
  });
});
