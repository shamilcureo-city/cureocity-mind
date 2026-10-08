/**
 * IndexedDB-backed persistence for audio chunks in flight.
 *
 * Invariants:
 *   - Each chunk is stored under primary key (sessionId, chunkIndex)
 *   - A chunk is INSERTED before the upload attempt
 *   - On successful upload (HTTP 201/200), the chunk is DELETED
 *   - On retryable failure, the chunk stays so the next online tick or
 *     a refresh recovery can pick it up
 *
 * Per gap G2 (session resume after refresh): we also persist the
 * session-level cursor so a fresh tab can resume at the right
 * chunkIndex with no overlap.
 */

const DB_NAME = 'cureocity-mind-audio';
const DB_VERSION = 1;
const CHUNKS_STORE = 'pending-chunks';
const SESSIONS_STORE = 'sessions';

export interface PersistedChunk {
  sessionId: string;
  chunkIndex: number;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
  bytes: Uint8Array;
  /** Insertion time, ms epoch. */
  enqueuedAt: number;
  /** Number of times we've tried to upload; informs backoff. */
  attempts: number;
  /** Last refusal; permanent payload/state failures need a different remedy. */
  lastHttpStatus?: number;
}

export interface PersistedSession {
  sessionId: string;
  /** Next chunkIndex to write — equivalent to chunker.nextIndex. */
  nextChunkIndex: number;
  /** Session-level wall-clock start time. */
  startedAt: number;
  /** A missing final worklet acknowledgement cannot be cured by upload retry. */
  captureIntegrityError?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, {
          keyPath: ['sessionId', 'chunkIndex'],
        });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const result = fn(s);
        if (result && typeof result === 'object' && 'onsuccess' in result) {
          const req = result as IDBRequest<T>;
          // A request success is not a durable transaction commit.
          t.oncomplete = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          t.onabort = () => reject(t.error ?? new Error('Audio storage transaction aborted'));
          t.onerror = () => reject(t.error);
        } else {
          t.oncomplete = () => resolve(result as T);
          t.onerror = () => reject(t.error);
        }
      }),
  );
}

export const ChunkStore = {
  async insert(chunk: PersistedChunk): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      // The read and insert share one read/write transaction, so two tabs
      // cannot both inspect an empty ordinal and replace each other's speech.
      const transaction = db.transaction(CHUNKS_STORE, 'readwrite');
      const store = transaction.objectStore(CHUNKS_STORE);
      const request = store.get([chunk.sessionId, chunk.chunkIndex]);
      let conflict: Error | null = null;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(conflict ?? transaction.error ?? new Error('Audio storage transaction aborted'));
      request.onsuccess = () => {
        const previous = request.result as PersistedChunk | undefined;
        if (previous && !sameAudioChunk(previous, chunk)) {
          conflict = new Error(
            'Another recording tab already saved different audio at this position. Keep both tabs open and stop recording; unsaved audio is still held in this tab.',
          );
          transaction.abort();
          return;
        }
        store.put(chunk);
      };
    });
  },

  async remove(sessionId: string, chunkIndex: number, acknowledged: PersistedChunk): Promise<void> {
    await mutateMatchingChunk(sessionId, chunkIndex, acknowledged, (store) =>
      store.delete([sessionId, chunkIndex]),
    );
  },

  async listForSession(sessionId: string): Promise<PersistedChunk[]> {
    return tx<PersistedChunk[]>(CHUNKS_STORE, 'readonly', (s) => {
      const idx = s.index('sessionId');
      return idx.getAll(IDBKeyRange.only(sessionId)) as IDBRequest<PersistedChunk[]>;
    });
  },

  async incrementAttempts(
    sessionId: string,
    chunkIndex: number,
    httpStatus?: number,
    attempted?: PersistedChunk,
  ): Promise<void> {
    await mutateMatchingChunk(sessionId, chunkIndex, attempted, (store, existing) => {
      store.put({ ...existing, attempts: existing.attempts + 1, lastHttpStatus: httpStatus });
    });
  },
  async resetRetryableAttempts(sessionId: string): Promise<void> {
    for (const chunk of await this.listForSession(sessionId)) {
      const status = chunk.lastHttpStatus;
      if (status && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) continue;
      await this.insert({ ...chunk, attempts: 0 });
    }
  },
};

/** A late uploader response must not delete or mutate a replacement recording. */
async function mutateMatchingChunk(
  sessionId: string,
  chunkIndex: number,
  expected: PersistedChunk | undefined,
  change: (store: IDBObjectStore, current: PersistedChunk) => void,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE);
    const request = store.get([sessionId, chunkIndex]);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Audio storage transaction aborted'));
    request.onsuccess = () => {
      const current = request.result as PersistedChunk | undefined;
      if (current && (!expected || sameAudioChunk(current, expected))) change(store, current);
    };
  });
}

export function sameAudioChunk(left: PersistedChunk, right: PersistedChunk): boolean {
  return (
    left.mimeType === right.mimeType &&
    left.sampleRate === right.sampleRate &&
    left.durationMs === right.durationMs &&
    left.bytes.byteLength === right.bytes.byteLength &&
    left.bytes.every((byte, index) => byte === right.bytes[index])
  );
}

export const SessionStore = {
  async saveCursor(record: PersistedSession): Promise<void> {
    await tx<IDBValidKey>(SESSIONS_STORE, 'readwrite', (s) => s.put(record));
  },

  async getCursor(sessionId: string): Promise<PersistedSession | null> {
    const got = await tx<PersistedSession | undefined>(
      SESSIONS_STORE,
      'readonly',
      (s) => s.get(sessionId) as IDBRequest<PersistedSession | undefined>,
    );
    return got ?? null;
  },

  async clear(sessionId: string): Promise<void> {
    await tx<undefined>(
      SESSIONS_STORE,
      'readwrite',
      (s) => s.delete(sessionId) as unknown as IDBRequest<undefined>,
    );
  },
};
