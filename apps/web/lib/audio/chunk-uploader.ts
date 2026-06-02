import { ChunkStore, type PersistedChunk } from './idb-chunk-store';

/**
 * Uploads persisted PCM chunks to the audio chunk endpoint and drains
 * the IDB queue. Retries with exponential backoff on transient (5xx/
 * 408/429/network) failures; surfaces 4xx as permanent.
 *
 * Wire format matches PUT /api/v1/audio/:sessionId/chunks/:chunkIndex:
 *   - Method PUT, Content-Type audio/pcm
 *   - X-Sample-Rate: 16000
 *   - X-Duration-Ms: <chunk.durationMs>
 *   - Body: raw little-endian 16-bit PCM bytes
 *
 * Idempotency: (sessionId, chunkIndex) is uniquely indexed server-side;
 * a duplicate PUT returns 200 (not 409) so a retry after success is a
 * harmless no-op.
 */

export interface UploaderOptions {
  /** Endpoint base, e.g. '/api/v1'. */
  scribeBase: string;
  /** Bearer token; if omitted, sends Bearer dev-bypass for AUTH_BYPASS mode. */
  getAuthToken?: () => Promise<string | null>;
  /** Max attempts per chunk before treating it as a dead letter. */
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
   * Upload a single chunk. Returns the outcome — never throws for
   * transport-level failures so the caller can update IDB attempts +
   * backoff intelligently.
   */
  async uploadOne(chunk: PersistedChunk): Promise<UploadOutcome> {
    const token = (await this.opts.getAuthToken?.()) ?? 'dev-bypass';
    const headers: Record<string, string> = {
      'Content-Type': chunk.mimeType,
      'X-Sample-Rate': String(chunk.sampleRate),
      'X-Duration-Ms': String(chunk.durationMs),
      Authorization: `Bearer ${token}`,
    };

    let res: Response;
    try {
      res = await fetch(
        `${this.opts.scribeBase}/audio/${encodeURIComponent(chunk.sessionId)}/chunks/${chunk.chunkIndex}`,
        {
          method: 'PUT',
          headers,
          body: chunk.bytes as Uint8Array<ArrayBuffer>,
        },
      );
    } catch (e) {
      return { status: 'transient', error: (e as Error).message };
    }

    if (res.ok) return { status: 'ok' };
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      return { status: 'transient', error: res.statusText, httpStatus: res.status };
    }
    return { status: 'permanent', error: res.statusText, httpStatus: res.status };
  }

  /**
   * Drains all pending chunks for a session from IDB, oldest-first.
   * Chunks past maxAttempts are left in IDB so a future drain (or a UI
   * recovery action) can surface them as a dead letter.
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
        if (chunk.attempts >= this.opts.maxAttempts) continue;
        const outcome = await this.uploadOne(chunk);
        if (outcome.status === 'ok') {
          await ChunkStore.remove(sessionId, chunk.chunkIndex);
        } else if (outcome.status === 'permanent') {
          await ChunkStore.incrementAttempts(sessionId, chunk.chunkIndex);
        } else {
          await ChunkStore.incrementAttempts(sessionId, chunk.chunkIndex);
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
