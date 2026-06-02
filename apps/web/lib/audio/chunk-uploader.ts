'use client';

import { upload } from '@vercel/blob/client';
import { ChunkStore, type PersistedChunk } from './idb-chunk-store';

/**
 * Uploads persisted PCM chunks DIRECTLY from the browser to Vercel Blob
 * storage using @vercel/blob/client.upload(). The Vercel function only
 * hands out a short-lived client token (~500 ms) — the 30 s / 960 KB
 * upload itself goes browser -> Blob edge, bypassing the function and
 * dodging the Hobby plan's 10 s function timeout.
 *
 * Flow per chunk:
 *   1. upload() POSTs handshake to /api/v1/audio/upload-token
 *      (our handleUpload route validates session ownership + status
 *       and returns a scoped token)
 *   2. upload() streams the PCM body to Blob storage edge directly
 *   3. Vercel Blob posts an upload-completed webhook back to our route
 *      which writes the AudioChunk row + AUDIO_CHUNK_UPLOADED audit
 *   4. upload() resolves with the blob URL on success
 *
 * Idempotency: (sessionId, chunkIndex) is uniquely indexed server-side
 * via Prisma, so a retried upload re-uses the same pathname and the
 * webhook's UNIQUE constraint short-circuits the second write.
 */

export interface UploaderOptions {
  /** Endpoint base, e.g. '/api/v1'. */
  scribeBase: string;
  /** Bearer token; if omitted, request runs in the dev bypass path. */
  getAuthToken?: () => Promise<string | null>;
  /** Max attempts per chunk before treating it as a dead letter. */
  maxAttempts?: number;
}

export type UploadOutcome =
  | { status: 'ok'; url?: string }
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
   * Uploads a single chunk via the client-direct path. Catches and
   * classifies failures so the IDB queue can back off intelligently.
   */
  async uploadOne(chunk: PersistedChunk): Promise<UploadOutcome> {
    const pathname = `sessions/${chunk.sessionId}/${chunk.chunkIndex}.pcm`;
    // PutBody accepts Blob | ReadableStream | File etc., but not raw
    // Uint8Array — wrap it in a Blob so the SDK can stream it.
    const body = new Blob([chunk.bytes as Uint8Array<ArrayBuffer>], { type: chunk.mimeType });
    try {
      const blob = await upload(pathname, body, {
        access: 'public',
        handleUploadUrl: `${this.opts.scribeBase}/audio/upload-token`,
        contentType: chunk.mimeType,
        clientPayload: JSON.stringify({
          durationMs: chunk.durationMs,
          sampleRate: chunk.sampleRate,
        }),
      });
      return { status: 'ok', url: blob.url };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const message = err.message ?? String(e);
      // Permanent: server rejected the handshake (auth / state / validation).
      // The handshake route returns 400 for these; the upload() SDK surfaces
      // the response body verbatim as the error message.
      const isPermanent =
        message.includes('Unauthorized') ||
        message.includes('not owned') ||
        message.includes('IN_PROGRESS state') ||
        message.includes('not found') ||
        message.includes('Invalid pathname') ||
        message.includes('Sample rate') ||
        message.includes('durationMs');
      if (isPermanent) {
        return { status: 'permanent', error: message, httpStatus: 400 };
      }
      return { status: 'transient', error: message };
    }
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
