import { ChunkStore, type PersistedChunk } from './idb-chunk-store';

/**
 * POSTs persisted chunks to scribe-service. Drains the IDB queue when
 * online; retries with exponential backoff on transient failures.
 *
 * Idempotency: scribe-service uses (sessionId, chunkIndex) uniqueness
 * (Sprint 2 PR 2) so re-posting after a flaky network is safe.
 */

export interface UploaderOptions {
  /** Endpoint base, e.g. http://localhost:3002/api/v1 */
  scribeBase: string;
  /** Bearer token; if omitted, sends Bearer dev-bypass for AUTH_BYPASS mode. */
  getAuthToken?: () => Promise<string | null>;
  /** Max attempts per chunk before surfacing to user. */
  maxAttempts?: number;
}

export type UploadOutcome =
  | { status: 'ok' }
  | { status: 'transient'; error: string; httpStatus?: number }
  | { status: 'permanent'; error: string; httpStatus: number };

export class ChunkUploader {
  private readonly opts: Required<Omit<UploaderOptions, 'getAuthToken'>> &
    Pick<UploaderOptions, 'getAuthToken'>;
  private draining = false;

  constructor(opts: UploaderOptions) {
    this.opts = {
      maxAttempts: 6,
      ...opts,
    };
  }

  /**
   * Upload a single chunk. Throws only on permanent (4xx) failures so the
   * caller can surface them. Returns false for transient failures so the
   * retry loop can keep the chunk in IDB.
   */
  async uploadOne(chunk: PersistedChunk): Promise<UploadOutcome> {
    const token = (await this.opts.getAuthToken?.()) ?? 'dev-bypass';
    const form = new FormData();
    form.set('chunkIndex', String(chunk.chunkIndex));
    form.set('mimeType', chunk.mimeType);
    form.set('sampleRate', String(chunk.sampleRate));
    form.set('durationMs', String(chunk.durationMs));
    form.set(
      'chunk',
      new Blob([chunk.bytes as Uint8Array<ArrayBuffer>], { type: chunk.mimeType }),
      `${String(chunk.chunkIndex).padStart(6, '0')}.pcm`,
    );

    let res: Response;
    try {
      res = await fetch(`${this.opts.scribeBase}/sessions/${chunk.sessionId}/audio-chunks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (e) {
      return { status: 'transient', error: (e as Error).message };
    }

    if (res.ok) return { status: 'ok' };
    if (res.status === 409) {
      // Duplicate — backend already has this chunkIndex. Treat as OK so
      // we drop it from the IDB queue.
      return { status: 'ok' };
    }
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      return { status: 'transient', error: res.statusText, httpStatus: res.status };
    }
    return { status: 'permanent', error: res.statusText, httpStatus: res.status };
  }

  /**
   * Drains all pending chunks for a session from IDB, oldest-first.
   * Skips chunks that have exhausted maxAttempts (caller's responsibility
   * to surface them via list() or a dedicated DLQ in Sprint 7 PR 5).
   */
  async drainSession(
    sessionId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const pending = (await ChunkStore.listForSession(sessionId)).sort(
        (a, b) => a.chunkIndex - b.chunkIndex,
      );
      let done = 0;
      for (const chunk of pending) {
        if (chunk.attempts >= this.opts.maxAttempts) {
          continue; // DLQ — surface upstream
        }
        const outcome = await this.uploadOne(chunk);
        if (outcome.status === 'ok') {
          await ChunkStore.remove(sessionId, chunk.chunkIndex);
        } else if (outcome.status === 'permanent') {
          // Permanent — increment attempts to push it past the cap, then surface.
          await ChunkStore.incrementAttempts(sessionId, chunk.chunkIndex);
        } else {
          await ChunkStore.incrementAttempts(sessionId, chunk.chunkIndex);
          // Exponential backoff before the next chunk.
          await sleep(backoffMs(chunk.attempts + 1));
        }
        done += 1;
        onProgress?.(done, pending.length);
      }
    } finally {
      this.draining = false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffMs(attempt: number): number {
  // 2s, 4s, 8s, 16s, 32s, 60s ceiling.
  return Math.min(60_000, Math.pow(2, attempt) * 1000);
}
