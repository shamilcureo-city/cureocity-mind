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
}

export interface PersistedSession {
  sessionId: string;
  /** Next chunkIndex to write — equivalent to chunker.nextIndex. */
  nextChunkIndex: number;
  /** Session-level wall-clock start time. */
  startedAt: number;
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
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } else {
          t.oncomplete = () => resolve(result as T);
          t.onerror = () => reject(t.error);
        }
      }),
  );
}

export const ChunkStore = {
  async insert(chunk: PersistedChunk): Promise<void> {
    await tx<IDBValidKey>(CHUNKS_STORE, 'readwrite', (s) => s.put(chunk));
  },

  async remove(sessionId: string, chunkIndex: number): Promise<void> {
    await tx<undefined>(
      CHUNKS_STORE,
      'readwrite',
      (s) => s.delete([sessionId, chunkIndex]) as unknown as IDBRequest<undefined>,
    );
  },

  async listForSession(sessionId: string): Promise<PersistedChunk[]> {
    return tx<PersistedChunk[]>(CHUNKS_STORE, 'readonly', (s) => {
      const idx = s.index('sessionId');
      return idx.getAll(IDBKeyRange.only(sessionId)) as IDBRequest<PersistedChunk[]>;
    });
  },

  async incrementAttempts(sessionId: string, chunkIndex: number): Promise<void> {
    const existing = await tx<PersistedChunk | undefined>(
      CHUNKS_STORE,
      'readonly',
      (s) => s.get([sessionId, chunkIndex]) as IDBRequest<PersistedChunk | undefined>,
    );
    if (!existing) return;
    existing.attempts += 1;
    await tx<IDBValidKey>(CHUNKS_STORE, 'readwrite', (s) => s.put(existing));
  },
};

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
