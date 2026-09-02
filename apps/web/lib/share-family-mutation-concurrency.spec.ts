import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Scenario = 'checkin' | 'homework';
  type Share = {
    id: string;
    resendOfId: string | null;
    shareBatchId: string;
    status: 'SENT' | 'OPENED' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE' | 'REVOKED';
    artefactType: 'INSTRUMENT_CHECKIN' | 'HOMEWORK';
    artefactId: string;
    snapshot: Record<string, unknown>;
    expiresAt: Date;
  };

  let releaseMutation!: () => void;
  let mutationReached!: () => void;
  let mutationGate: Promise<void>;
  let mutationReachedGate: Promise<void>;
  const resetGates = () => {
    mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    mutationReachedGate = new Promise<void>((resolve) => {
      mutationReached = resolve;
    });
  };
  resetGates();

  return {
    scenario: 'checkin' as Scenario,
    shares: new Map<string, Share>(),
    responseWrites: [] as string[],
    events: [] as string[],
    writeAudit: vi.fn(),
    resetGates,
    releaseMutation: () => releaseMutation(),
    waitForMutation: () => mutationReachedGate,
    pauseMutation: async () => {
      mutationReached();
      await mutationGate;
    },
  };
});

vi.mock('@cureocity/contracts', () => ({
  PatientShareTokenSchema: { safeParse: (value: string) => ({ success: true, data: value }) },
  CheckinSubmitInputSchema: {},
  HomeworkResponseInputSchema: {},
  ClinicalLocaleSchema: { safeParse: () => ({ success: true }) },
  InstrumentCheckinSnapshotSchema: {
    safeParse: (value: Record<string, unknown>) =>
      value?.kind === 'INSTRUMENT_CHECKIN' ? { success: true, data: value } : { success: false },
  },
  HomeworkSnapshotSchema: {
    safeParse: (value: Record<string, unknown>) =>
      value?.kind === 'HOMEWORK' ? { success: true, data: value } : { success: false },
  },
  TherapyScriptSnapshotSchema: { safeParse: () => ({ success: false }) },
}));
vi.mock('@cureocity/clinical', () => ({
  INSTRUMENTS: { PHQ9: { key: 'PHQ9' } },
  InstrumentScoringError: class extends Error {},
  scoreInstrument: () => ({ score: 0, severityKey: 'minimal', riskFlagged: false }),
}));
vi.mock('./auth-server', () => ({
  requireCapability: async () => ({ ok: true, value: { psychologistId: 'psy-1' } }),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({}),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./validate', () => ({
  parseJson: async () =>
    mocks.scenario === 'checkin'
      ? { ok: true, value: { responses: { q1: 0 } } }
      : { ok: true, value: { outcome: 'DONE', reflection: 'helped' } },
}));
vi.mock('./crisis-alert-outbox', () => ({ processCrisisAlertOutbox: vi.fn() }));
vi.mock('./prisma', () => {
  const heldLocks = new Map<string, Promise<void>>();

  function requestedLock(args: unknown[]): string | null {
    if (typeof args[1] === 'string') return args[1];
    const sql = args[0] as { values?: unknown[] } | undefined;
    return typeof sql?.values?.[0] === 'string' ? sql.values[0] : null;
  }

  const patientShare = {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; shareToken?: string } }) => {
      const id = where.id ?? 'share-child';
      const share = mocks.shares.get(id);
      if (!share) return null;
      return {
        ...share,
        clientId: 'client-1',
        psychologistId: 'psy-1',
        sessionId: 'session-1',
        language: 'en',
        channel: 'EMAIL',
        psychologist: { email: 'therapist@example.test', fullName: 'Therapist' },
      };
    }),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('resendOfId' in where) {
        const parentIds = (where.resendOfId as { in: string[] }).in;
        return [...mocks.shares.values()]
          .filter((share) => share.resendOfId && parentIds.includes(share.resendOfId))
          .map((share) => ({ id: share.id }));
      }
      return [...mocks.shares.values()].map((share) => ({ ...share }));
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const share = mocks.shares.get(where.id)!;
        Object.assign(share, data);
        return { ...share };
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string | { in: string[] }; status?: string | { in?: string[]; not?: string } };
        data: Record<string, unknown>;
      }) => {
        const ids = typeof where.id === 'string' ? [where.id] : where.id.in;
        let count = 0;
        for (const id of ids) {
          const share = mocks.shares.get(id);
          if (!share) continue;
          const statuses = typeof where.status === 'object' ? where.status.in : undefined;
          if (statuses && !statuses.includes(share.status)) continue;
          if (typeof where.status === 'string' && share.status !== where.status) continue;
          Object.assign(share, data);
          count += 1;
        }
        return { count };
      },
    ),
  };

  const tx = {
    $executeRaw: vi.fn(),
    patientShare,
    instrumentResponse: {
      create: vi.fn(async () => {
        await mocks.pauseMutation();
        mocks.responseWrites.push('checkin');
        mocks.events.push('mutation-write');
        return { id: 'response-1' };
      }),
    },
    exerciseAssignment: {
      findFirst: vi.fn(async () => ({ id: 'assignment-1', response: null })),
      update: vi.fn(async () => {
        await mocks.pauseMutation();
        mocks.responseWrites.push('homework');
        mocks.events.push('mutation-write');
        return {};
      }),
    },
    crisisAlertAttempt: { create: vi.fn() },
  };

  return {
    prisma: {
      patientShare,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => {
        const releases: Array<() => void> = [];
        tx.$executeRaw.mockImplementation(async (...args: unknown[]) => {
          const key = requestedLock(args);
          if (!key) return 0;
          const previous = heldLocks.get(key) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((resolve) => {
            release = resolve;
          });
          heldLocks.set(
            key,
            previous.then(() => mine),
          );
          await previous;
          releases.push(() => {
            release();
            if (heldLocks.get(key) === mine) heldLocks.delete(key);
          });
          return 0;
        });
        try {
          return await callback(tx);
        } finally {
          releases.reverse().forEach((release) => release());
        }
      }),
    },
  };
});

import { POST as submitCheckin } from '../app/api/v1/p/[token]/checkin/route';
import { POST as submitHomework } from '../app/api/v1/p/[token]/homework/route';
import { POST as revoke } from '../app/api/v1/shares/[id]/revoke/route';

function seed(scenario: 'checkin' | 'homework') {
  mocks.scenario = scenario;
  mocks.shares.clear();
  mocks.responseWrites.length = 0;
  mocks.events.length = 0;
  mocks.resetGates();
  const expiresAt = new Date(Date.now() + 60_000);
  mocks.shares.set('share-root', {
    id: 'share-root',
    resendOfId: null,
    shareBatchId: 'batch-1',
    status: 'SENT',
    artefactType: scenario === 'checkin' ? 'INSTRUMENT_CHECKIN' : 'HOMEWORK',
    artefactId: 'assignment-1',
    snapshot:
      scenario === 'checkin'
        ? { kind: 'INSTRUMENT_CHECKIN', instrumentKey: 'PHQ9', completed: false }
        : { kind: 'HOMEWORK', assignmentId: 'assignment-1' },
    expiresAt,
  });
  mocks.shares.set('share-child', {
    ...mocks.shares.get('share-root')!,
    id: 'share-child',
    resendOfId: 'share-root',
  });
}

async function revokeRoot() {
  const response = await revoke(
    new Request('https://example.test/api/v1/shares/share-root/revoke', {
      method: 'POST',
    }) as never,
    { params: Promise.resolve({ id: 'share-root' }) },
  );
  mocks.events.push('revoke-complete');
  return response;
}

async function allowWithdrawalToWinUnlessLocked(withdrawal: Promise<Response>) {
  await Promise.race([withdrawal, new Promise<void>((resolve) => setTimeout(resolve, 25))]);
  mocks.releaseMutation();
}

function expectSerializedOutcome(mutationStatus: number, revokeStatus: number) {
  expect(revokeStatus).toBe(200);
  if (mutationStatus === 200) {
    expect(mocks.events).toEqual(['mutation-write', 'revoke-complete']);
    expect(mocks.responseWrites).toHaveLength(1);
  } else {
    expect(mocks.responseWrites).toHaveLength(0);
  }
  expect(mocks.events).not.toEqual(['revoke-complete', 'mutation-write']);
}

describe('root withdrawal versus descendant portal mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes descendant check-in so no response is written after root revoke completes', async () => {
    seed('checkin');
    const mutation = submitCheckin(
      new Request('https://example.test/api/v1/p/child-token/checkin', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'child-token' }) },
    );
    await mocks.waitForMutation();
    const withdrawal = revokeRoot();
    await allowWithdrawalToWinUnlessLocked(withdrawal);

    const [mutationResponse, revokeResponse] = await Promise.all([mutation, withdrawal]);
    expectSerializedOutcome(mutationResponse.status, revokeResponse.status);
  });

  it('serializes descendant homework so no response is written after root revoke completes', async () => {
    seed('homework');
    const mutation = submitHomework(
      new Request('https://example.test/api/v1/p/child-token/homework', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'child-token' }) },
    );
    await mocks.waitForMutation();
    const withdrawal = revokeRoot();
    await allowWithdrawalToWinUnlessLocked(withdrawal);

    const [mutationResponse, revokeResponse] = await Promise.all([mutation, withdrawal]);
    expectSerializedOutcome(mutationResponse.status, revokeResponse.status);
  });

  it.each([
    ['checkin', 'TRANSIENT_FAILURE'],
    ['checkin', 'PERMANENT_FAILURE'],
    ['homework', 'TRANSIENT_FAILURE'],
    ['homework', 'PERMANENT_FAILURE'],
  ] as const)(
    'accepts a delivered %s resend whose source ended in %s',
    async (scenario, status) => {
      seed(scenario);
      mocks.shares.get('share-root')!.status = status;
      const mutation =
        scenario === 'checkin'
          ? submitCheckin(
              new Request('https://example.test/api/v1/p/child-token/checkin', {
                method: 'POST',
                body: '{}',
              }) as never,
              { params: Promise.resolve({ token: 'child-token' }) },
            )
          : submitHomework(
              new Request('https://example.test/api/v1/p/child-token/homework', {
                method: 'POST',
                body: '{}',
              }) as never,
              { params: Promise.resolve({ token: 'child-token' }) },
            );
      await mocks.waitForMutation();
      mocks.releaseMutation();
      expect((await mutation).status).toBe(200);
    },
  );
});
