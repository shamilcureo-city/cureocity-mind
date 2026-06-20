'use client';

import { ChunkStore, type PersistedChunk } from './idb-chunk-store';

/**
 * Uploads persisted PCM chunks to the server's inline-storage endpoint
 * (POST /audio/chunks/upload — body = raw bytes, metadata in headers).
 * The route writes the chunk into Postgres BYTEA in a single Prisma
 * transaction.
 *
 * Replaces the previous Vercel Blob client-direct path which was
 * observed to hang silently in production after the handshake (the
 * browser's PUT to Blob storage edge never resolved). Postgres inline
 * storage has higher per-session storage cost but a deterministic,
 * function-bounded request lifecycle — under 4 s even cold-started
 * on Hobby for a ~960 KB chunk.
 */

export interface UploaderOptions {
  /** Endpoint base, e.g. '/api/v1'. */
  scribeBase: string;
  /** Bearer token; if omitted, request runs in the dev-bypass path. */
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

  async uploadOne(chunk: PersistedChunk): Promise<UploadOutcome> {
    const headers: Record<string, string> = {
      'content-type': chunk.mimeType,
      'x-session-id': chunk.sessionId,
      'x-chunk-index': String(chunk.chunkIndex),
      'x-duration-ms': String(chunk.durationMs),
      'x-sample-rate': String(chunk.sampleRate),
    };
    if (this.opts.getAuthToken) {
      const token = await this.opts.getAuthToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    try {
      const res = await fetch(`${this.opts.scribeBase}/audio/chunks/upload`, {
        method: 'POST',
        headers,
        body: chunk.bytes as Uint8Array<ArrayBuffer>,
      });
      if (res.ok) return { status: 'ok' };
      const errorBody = await res.text().catch(() => '');
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return {
          status: 'permanent',
          error: errorBody || `HTTP ${res.status}`,
          httpStatus: res.status,
        };
      }
      return {
        status: 'transient',
        error: errorBody || `HTTP ${res.status}`,
        httpStatus: res.status,
      };
    } catch (e) {
      const err = e as { message?: string };
      return { status: 'transient', error: err.message ?? String(e) };
    }
  }

  /**
   * Drains all pending chunks for a session from IDB, oldest-first.
   * Chunks past maxAttempts are left in IDB for a future drain or UI
   * recovery action.
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
