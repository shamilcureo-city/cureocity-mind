import { StorageNotFoundError } from '@cureocity/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  runErasureObjectDeletionWorker,
  type ClaimedErasureObjectDeletionTask,
  type ErasureObjectDeletionTaskStore,
} from './dpdp-object-deletion-worker';

type Row = ClaimedErasureObjectDeletionTask & {
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'COMPLETED';
  attempts: number;
  leaseExpiresAt: Date | null;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
};

function fakeStore(seed: Row[]) {
  const rows = new Map(seed.map((row) => [row.id, row]));
  const store: ErasureObjectDeletionTaskStore = {
    async claim({ now, leaseExpiresAt, leaseToken }) {
      const row = [...rows.values()].find(
        (candidate) =>
          candidate.status !== 'COMPLETED' &&
          candidate.nextAttemptAt <= now &&
          (candidate.status !== 'PROCESSING' ||
            !candidate.leaseExpiresAt ||
            candidate.leaseExpiresAt <= now),
      );
      if (!row) return null;
      row.status = 'PROCESSING';
      row.attempts += 1;
      row.leaseToken = leaseToken;
      row.leaseExpiresAt = leaseExpiresAt;
      return { ...row };
    },
    async complete({ id, leaseToken, now }) {
      const row = rows.get(id)!;
      if (row.status !== 'PROCESSING' || row.leaseToken !== leaseToken) return false;
      row.status = 'COMPLETED';
      row.objectKey = null;
      row.completedAt = now;
      row.leaseExpiresAt = null;
      row.leaseToken = null;
      row.lastErrorCode = null;
      return true;
    },
    async fail({ id, leaseToken, errorCode, nextAttemptAt }) {
      const row = rows.get(id)!;
      if (row.status !== 'PROCESSING' || row.leaseToken !== leaseToken) return false;
      row.status = 'FAILED';
      row.lastErrorCode = errorCode;
      row.nextAttemptAt = nextAttemptAt;
      row.leaseExpiresAt = null;
      row.leaseToken = null;
      return true;
    },
  };
  return { store, rows };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'task-1',
    storageProvider: 'S3',
    objectKey: 'sessions/private-client/chunks/000001.pcm',
    leaseToken: null,
    completedAt: null,
    status: 'PENDING',
    attempts: 0,
    leaseExpiresAt: null,
    nextAttemptAt: new Date(0),
    lastErrorCode: null,
    ...overrides,
  };
}

const NOW = new Date('2026-09-15T00:00:00.000Z');

it('atomically gives one task to concurrent workers', async () => {
  const { store, rows } = fakeStore([row()]);
  const remove = vi.fn(async () => undefined);
  const deps = {
    store,
    remove,
    now: () => NOW,
    randomUUID: vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b'),
  };
  const [first, second] = await Promise.all([
    runErasureObjectDeletionWorker(deps),
    runErasureObjectDeletionWorker(deps),
  ]);
  expect(first.completed + second.completed).toBe(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(rows.get('task-1')).toMatchObject({ status: 'COMPLETED', objectKey: null });
});

it('reclaims an expired lease after a crashed worker', async () => {
  const { store, rows } = fakeStore([
    row({ status: 'PROCESSING', leaseToken: 'dead', leaseExpiresAt: new Date(NOW.getTime() - 1) }),
  ]);
  const remove = vi.fn(async () => undefined);
  const result = await runErasureObjectDeletionWorker({
    store,
    remove,
    now: () => NOW,
    randomUUID: () => 'live',
  });
  expect(result.completed).toBe(1);
  expect(rows.get('task-1')?.attempts).toBe(1);
});

it('backs off a transient failure and retries without exposing its message', async () => {
  const { store, rows } = fakeStore([row()]);
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new Error('patient Jane Doe at secret/key'))
    .mockResolvedValueOnce(undefined);
  const log = vi.fn();
  const first = await runErasureObjectDeletionWorker({
    store,
    remove,
    now: () => NOW,
    randomUUID: () => 'one',
    log,
  });
  expect(first.failed).toBe(1);
  expect(rows.get('task-1')).toMatchObject({ status: 'FAILED', lastErrorCode: 'STORAGE_ERROR' });
  expect(rows.get('task-1')!.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
  expect(JSON.stringify(log.mock.calls)).not.toContain('Jane Doe');
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret/key');

  const retryAt = rows.get('task-1')!.nextAttemptAt;
  const second = await runErasureObjectDeletionWorker({
    store,
    remove,
    now: () => retryAt,
    randomUUID: () => 'two',
    log,
  });
  expect(second.completed).toBe(1);
  expect(remove).toHaveBeenCalledTimes(2);
});

it('treats object-not-found as idempotent deletion success', async () => {
  const { store, rows } = fakeStore([row()]);
  const remove = vi.fn(async ({ bucket, key }: { bucket: string; key: string }) => {
    throw new StorageNotFoundError(bucket, key);
  });
  const result = await runErasureObjectDeletionWorker({
    store,
    remove,
    now: () => NOW,
    randomUUID: () => 'lease',
  });
  expect(result.completed).toBe(1);
  expect(rows.get('task-1')).toMatchObject({ status: 'COMPLETED', objectKey: null });
});

describe('fail-closed task inputs', () => {
  it('does not call storage for an unsupported provider or a cleared key', async () => {
    const { store } = fakeStore([row({ storageProvider: 'GCS', objectKey: null })]);
    const remove = vi.fn(async () => undefined);
    const result = await runErasureObjectDeletionWorker({
      store,
      remove,
      now: () => NOW,
      randomUUID: () => 'lease',
    });
    expect(result.failed).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
