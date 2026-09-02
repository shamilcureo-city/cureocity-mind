import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveClient: vi.fn(),
  clientFindFirst: vi.fn(),
  shareFindFirst: vi.fn(),
  transaction: vi.fn(),
  writeAudit: vi.fn(),
  flagEnabled: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  CLIENT_CARE_HOME_ORDER: [],
  PatientShareSnapshotSchema: { safeParse: vi.fn() },
  ClientCareHomeSchema: { parse: vi.fn() },
}));
vi.mock('./auth-server', () => ({ resolveClient: mocks.resolveClient }));
vi.mock('./mind-journey-flags', () => ({
  mindJourneyFlagEnabledFromEnv: mocks.flagEnabled,
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findFirst: mocks.clientFindFirst },
    patientShare: { findFirst: mocks.shareFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '../app/api/v1/p/home/route';

function request(headers: HeadersInit = {}) {
  return new Request('https://mind.example/api/v1/p/home', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ shareId: 'share-1' }),
  });
}

describe('client care-home POST mutation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveClient.mockResolvedValue({
      ok: true,
      value: { firebaseUid: 'client-uid', clientId: 'client-1' },
    });
    mocks.clientFindFirst.mockResolvedValue({
      id: 'client-1',
      psychologistId: 'psy-1',
      psychologist: { vertical: 'THERAPIST' },
    });
    mocks.flagEnabled.mockReturnValue(true);
    mocks.shareFindFirst.mockResolvedValue({ id: 'share-1', shareBatchId: 'batch-1' });
    mocks.transaction.mockResolvedValue(false);
  });

  it('rejects a cross-origin cookie mutation before cookie-capable authentication', async () => {
    const response = await POST(
      request({ cookie: '__session=x', origin: 'https://evil.example' }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Cross-site mutation blocked' });
    expect(mocks.resolveClient).not.toHaveBeenCalled();
    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('keeps explicit bearer clients supported without browser origin headers', async () => {
    const response = await POST(request({ authorization: 'Bearer client-token' }) as never);

    expect(response.status).toBe(404);
    expect(mocks.resolveClient).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('rejects a Doctor-owned client before any refresh write or audit', async () => {
    mocks.clientFindFirst.mockResolvedValue({
      id: 'client-1',
      psychologistId: 'doctor-1',
      psychologist: { vertical: 'DOCTOR' },
    });
    mocks.flagEnabled.mockReturnValue(false);

    const response = await POST(request({ authorization: 'Bearer client-token' }) as never);

    expect(response.status).toBe(404);
    expect(mocks.flagEnabled).toHaveBeenCalledWith('clientCareLoop', 'DOCTOR');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('rejects a Therapist-owned client without clientCareLoop before any write or audit', async () => {
    mocks.flagEnabled.mockReturnValue(false);

    const response = await POST(request({ authorization: 'Bearer client-token' }) as never);

    expect(response.status).toBe(404);
    expect(mocks.flagEnabled).toHaveBeenCalledWith('clientCareLoop', 'THERAPIST');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('accepts concurrent and repeated refresh requests without count or audit amplification', async () => {
    const state = { refreshRequestedAt: null as Date | null, refreshRequestCount: 0 };
    let previous = Promise.resolve();
    const tx = {
      $executeRaw: vi.fn(),
      patientShare: {
        findFirst: vi.fn(async () => ({
          id: 'share-1',
          clientId: 'client-1',
          psychologistId: 'psy-1',
        })),
        update: vi.fn(async () => {
          state.refreshRequestedAt = new Date();
          state.refreshRequestCount += 1;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          const cooldown = where.OR[1].refreshRequestedAt.lt as Date;
          const eligible =
            state.refreshRequestedAt === null ||
            state.refreshRequestedAt.getTime() < cooldown.getTime();
          if (!eligible) return { count: 0 };
          state.refreshRequestedAt = data.refreshRequestedAt;
          state.refreshRequestCount += 1;
          return { count: 1 };
        }),
      },
    };
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => {
      const running = previous.then(() => callback(tx));
      previous = running.then(
        () => undefined,
        () => undefined,
      );
      return running;
    });

    const concurrent = await Promise.all([
      POST(request({ authorization: 'Bearer client-token' }) as never),
      POST(request({ authorization: 'Bearer client-token' }) as never),
      POST(request({ authorization: 'Bearer client-token' }) as never),
    ]);
    const repeated = await POST(request({ authorization: 'Bearer client-token' }) as never);

    expect([...concurrent, repeated].map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    expect(state.refreshRequestCount).toBe(1);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });
});
