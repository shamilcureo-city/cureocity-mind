import { StorageNotFoundError } from '@cureocity/storage';

export interface ClaimedErasureObjectDeletionTask {
  id: string;
  storageProvider: string;
  objectKey: string | null;
  leaseToken: string | null;
  completedAt: Date | null;
  attempts?: number;
}

export interface ErasureObjectDeletionTaskStore {
  claim(input: {
    now: Date;
    leaseExpiresAt: Date;
    leaseToken: string;
  }): Promise<ClaimedErasureObjectDeletionTask | null>;
  complete(input: { id: string; leaseToken: string; now: Date }): Promise<boolean>;
  fail(input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    nextAttemptAt: Date;
  }): Promise<boolean>;
}

export interface ErasureObjectDeletionWorkerResult {
  claimed: number;
  completed: number;
  failed: number;
  stale: number;
}

interface WorkerDependencies {
  store: ErasureObjectDeletionTaskStore;
  remove: (input: { bucket: string; key: string }) => Promise<void>;
  bucket?: string;
  now?: () => Date;
  randomUUID?: () => string;
  log?: (event: {
    event: 'completed' | 'failed' | 'stale';
    taskId: string;
    errorCode?: string;
  }) => void;
  maxTasks?: number;
  leaseMs?: number;
}

const DEFAULT_BUCKET = 'cureocity-mind-audio';
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 10));
}

/**
 * Drains the durable DPDP object-deletion outbox. Logs contain only task IDs
 * and bounded codes: object keys and provider error text can contain PHI and
 * must never be emitted.
 */
export async function runErasureObjectDeletionWorker(
  deps: WorkerDependencies,
): Promise<ErasureObjectDeletionWorkerResult> {
  const now = deps.now ?? (() => new Date());
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const result: ErasureObjectDeletionWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    stale: 0,
  };
  const maxTasks = deps.maxTasks ?? 25;
  const leaseMs = deps.leaseMs ?? 5 * 60_000;

  for (let index = 0; index < maxTasks; index += 1) {
    const claimedAt = now();
    const leaseToken = randomUUID();
    const task = await deps.store.claim({
      now: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs),
      leaseToken,
    });
    if (!task) break;
    result.claimed += 1;

    let errorCode: string | null = null;
    if (task.storageProvider !== 'S3') errorCode = 'UNSUPPORTED_PROVIDER';
    else if (!task.objectKey) errorCode = 'MISSING_OBJECT_KEY';
    else {
      try {
        await deps.remove({ bucket: deps.bucket ?? DEFAULT_BUCKET, key: task.objectKey });
      } catch (error) {
        if (!(error instanceof StorageNotFoundError)) errorCode = 'STORAGE_ERROR';
      }
    }

    if (errorCode === null) {
      const updated = await deps.store.complete({ id: task.id, leaseToken, now: now() });
      if (updated) {
        result.completed += 1;
        deps.log?.({ event: 'completed', taskId: task.id });
      } else {
        result.stale += 1;
        deps.log?.({ event: 'stale', taskId: task.id });
      }
      continue;
    }

    const retryAt = new Date(now().getTime() + backoffMs(task.attempts ?? 1));
    const updated = await deps.store.fail({
      id: task.id,
      leaseToken,
      errorCode,
      nextAttemptAt: retryAt,
    });
    if (updated) {
      result.failed += 1;
      deps.log?.({ event: 'failed', taskId: task.id, errorCode });
    } else {
      result.stale += 1;
      deps.log?.({ event: 'stale', taskId: task.id });
    }
  }

  return result;
}
