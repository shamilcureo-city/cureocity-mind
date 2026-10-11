import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedChunk } from './idb-chunk-store';

describe('atomic browser audio insert', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const chunk: PersistedChunk = {
    sessionId: 'session-1',
    chunkIndex: 0,
    mimeType: 'audio/pcm',
    sampleRate: 16000,
    durationMs: 1000,
    bytes,
    enqueuedAt: 1,
    attempts: 0,
  };
  let stored: PersistedChunk | undefined;
  let transactions: string[];
  beforeEach(() => {
    vi.resetModules();
    stored = undefined;
    transactions = [];
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Record<string, unknown> = {};
        const db = {
          transaction: (_store: string, mode: string) => {
            transactions.push(mode);
            const transaction = {
              oncomplete: () => {},
              onabort: () => {},
              onerror: () => {},
              abort: () => queueMicrotask(() => transaction.onabort()),
              objectStore: () => ({
                get: () => {
                  const get = { result: stored, onsuccess: () => {} };
                  queueMicrotask(() => {
                    get.onsuccess();
                    queueMicrotask(() => transaction.oncomplete());
                  });
                  return get;
                },
                put: (value: PersistedChunk) => {
                  stored = value;
                  queueMicrotask(() => transaction.oncomplete());
                },
                delete: () => {
                  stored = undefined;
                  queueMicrotask(() => transaction.oncomplete());
                },
              }),
            };
            return transaction;
          },
        };
        queueMicrotask(() => {
          request.result = db;
          (request.onsuccess as () => void)();
        });
        return request;
      },
    });
  });
  it('does not let a late acknowledgement or refusal mutate replacement audio', async () => {
    const { ChunkStore } = await import('./idb-chunk-store');
    await ChunkStore.insert(chunk);
    await ChunkStore.remove(chunk.sessionId, chunk.chunkIndex, chunk);
    const replacement = { ...chunk, bytes: new Uint8Array([9, 8, 7, 6]) };
    await ChunkStore.insert(replacement);
    await ChunkStore.remove(chunk.sessionId, chunk.chunkIndex, chunk);
    await ChunkStore.incrementAttempts(chunk.sessionId, chunk.chunkIndex, 409, chunk);
    expect(stored?.bytes).toEqual(replacement.bytes);
    expect(stored?.attempts).toBe(0);
    expect(stored?.lastHttpStatus).toBeUndefined();
    await ChunkStore.incrementAttempts(chunk.sessionId, chunk.chunkIndex, 503, replacement);
    expect(stored?.attempts).toBe(1);
    await ChunkStore.remove(chunk.sessionId, chunk.chunkIndex, replacement);
    expect(stored).toBeUndefined();
    vi.unstubAllGlobals();
  });
  it('refuses a local ordinal collision and leaves the original speech intact', async () => {
    const { ChunkStore } = await import('./idb-chunk-store');
    await ChunkStore.insert(chunk);
    await expect(
      ChunkStore.insert({ ...chunk, bytes: new Uint8Array([9, 8, 7, 6]) }),
    ).rejects.toThrow('Another recording tab');
    expect(stored?.bytes).toEqual(bytes);
    expect(transactions).toEqual(['readwrite', 'readwrite']);
    vi.unstubAllGlobals();
  });
  it('allows only byte-identical retry bookkeeping at an existing ordinal', async () => {
    const { ChunkStore } = await import('./idb-chunk-store');
    await ChunkStore.insert(chunk);
    await ChunkStore.insert({ ...chunk, attempts: 2 });
    expect(stored?.attempts).toBe(2);
    await expect(ChunkStore.insert({ ...chunk, durationMs: 900 })).rejects.toThrow(
      'Another recording tab',
    );
    expect(stored?.durationMs).toBe(1000);
    vi.unstubAllGlobals();
  });
});
