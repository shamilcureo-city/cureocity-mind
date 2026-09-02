import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reservations: [] as Array<{
    psychologistId: string;
    shareBatchId: string;
    fanout: number;
    ownerToken: string;
    expiresAt: Date;
    createdAt: Date;
  }>,
  createdRows: 0,
  deleteCalls: 0,
  chain: Promise.resolve() as Promise<unknown>,
}));

vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: vi.fn(),
    patientShare: {
      count: vi.fn(async ({ where }) => (where?.shareBatchId ? state.createdRows : 0)),
    },
    shareRateReservation: {
      deleteMany: vi.fn(async ({ where }) => {
        const before = state.reservations.length;
        state.reservations = state.reservations.filter((row) => {
          if (where.ownerToken) {
            return !(
              row.psychologistId === where.psychologistId &&
              row.shareBatchId === where.shareBatchId &&
              row.ownerToken === where.ownerToken
            );
          }
          return !(
            row.psychologistId === where.psychologistId && row.expiresAt <= where.expiresAt.lte
          );
        });
        if (where.ownerToken) state.deleteCalls += 1;
        return { count: before - state.reservations.length };
      }),
      findMany: vi.fn(async () =>
        state.reservations.map(({ shareBatchId, fanout }) => ({ shareBatchId, fanout })),
      ),
      findUnique: vi.fn(
        async ({ where }) =>
          state.reservations.find((row) => row.shareBatchId === where.shareBatchId) ?? null,
      ),
      create: vi.fn(async ({ data }) => {
        state.reservations.push({ ...data, createdAt: new Date() });
        return data;
      }),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn((work: (value: typeof tx) => unknown) => {
        const run = state.chain.then(() => work(tx));
        state.chain = run.catch(() => undefined);
        return run;
      }),
    },
  };
});

import {
  __finalizeShareCapacityReservation,
  __reserveShareCapacity,
} from '../app/api/v1/share/route';

describe('share-rate reservation concurrent lifecycle', () => {
  beforeEach(() => {
    state.reservations = [];
    state.createdRows = 0;
    state.deleteCalls = 0;
    state.chain = Promise.resolve();
  });

  it('assigns one owner to concurrent idempotent callers and only that owner finalizes', async () => {
    const [first, second] = await Promise.all([
      __reserveShareCapacity('psy-1', 'batch-1', 2),
      __reserveShareCapacity('psy-1', 'batch-1', 2),
    ]);

    expect(first?.ownerToken).toEqual(expect.any(String));
    expect(second).toEqual({ ownerToken: null });
    expect(state.reservations).toHaveLength(1);

    state.createdRows = 2;
    await Promise.all([
      __finalizeShareCapacityReservation('psy-1', 'batch-1', first!.ownerToken!, 2),
      // A non-owner/stale token is harmless and cannot remove the reservation.
      __finalizeShareCapacityReservation('psy-1', 'batch-1', 'not-owner', 2),
    ]);

    expect(state.reservations).toHaveLength(0);
    expect(state.deleteCalls).toBe(2);
  });

  it('does not release capacity until every expected fanout row exists', async () => {
    const reservation = await __reserveShareCapacity('psy-1', 'batch-1', 1);
    state.createdRows = 1;

    await __finalizeShareCapacityReservation('psy-1', 'batch-1', reservation!.ownerToken!, 2);
    expect(state.reservations).toHaveLength(1);

    state.createdRows = 2;
    await __finalizeShareCapacityReservation('psy-1', 'batch-1', reservation!.ownerToken!, 2);
    expect(state.reservations).toHaveLength(0);
  });
});
