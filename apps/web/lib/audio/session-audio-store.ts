import type { RecoveryContext } from '../live-recovery-draft';
import { sameAudioChunk, type PersistedChunk, type PersistedSession } from './idb-chunk-store';

const DB_NAME = 'cureocity-mind-audio';
const LEGACY_CHUNKS = 'pending-chunks';
const LEGACY_CURSORS = 'sessions';
const CHUNKS = 'pending-chunks-v2';
const CURSORS = 'sessions-v2';
const DISCARDED = 'Unsaved audio was discarded. This recording cannot be finalized as complete.';
const CONFLICT =
  'Another recording tab changed this recording. Keep both tabs open and review the unsaved audio.';

export interface SessionAudioStore {
  chunks: {
    insert(chunk: PersistedChunk): Promise<void>;
    remove(sessionId: string, chunkIndex: number, acknowledged: PersistedChunk): Promise<void>;
    listForSession(sessionId: string): Promise<PersistedChunk[]>;
    incrementAttempts(
      sessionId: string,
      chunkIndex: number,
      httpStatus?: number,
      attempted?: PersistedChunk,
    ): Promise<void>;
    resetRetryableAttempts(sessionId: string): Promise<void>;
  };
  cursor: {
    saveCursor(record: PersistedSession): Promise<void>;
    getCursor(sessionId: string): Promise<PersistedSession | null>;
    clear(sessionId: string): Promise<void>;
  };
  /** Call only after the user explicitly confirms losing these unsaved parts. */
  discardPending(): Promise<void>;
  close(): void;
}

interface Envelope {
  version: 2;
  accountId: string;
  sessionId: string;
  chunkIndex: number;
  iv: string;
  ciphertext: string;
}

interface Change {
  store: string;
  key: IDBValidKey;
  before: unknown;
  /** undefined means compare only; null means delete. */
  after?: unknown;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Exact stored snapshots, including nonce and bookkeeping, not just audio bytes. */
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function chunkValue(value: unknown, sessionId: string): PersistedChunk {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved audio');
  const chunk = value as PersistedChunk;
  if (
    chunk.sessionId !== sessionId ||
    !Number.isSafeInteger(chunk.chunkIndex) ||
    chunk.chunkIndex < 0 ||
    typeof chunk.mimeType !== 'string' ||
    !Number.isFinite(chunk.sampleRate) ||
    chunk.sampleRate <= 0 ||
    !Number.isFinite(chunk.durationMs) ||
    chunk.durationMs < 0 ||
    !(chunk.bytes instanceof Uint8Array) ||
    !Number.isFinite(chunk.enqueuedAt) ||
    !Number.isSafeInteger(chunk.attempts) ||
    chunk.attempts < 0 ||
    (chunk.lastHttpStatus !== undefined && !Number.isInteger(chunk.lastHttpStatus))
  )
    throw new Error('Invalid saved audio');
  return chunk;
}

function cursorValue(value: unknown, sessionId: string): PersistedSession {
  if (!value || typeof value !== 'object') throw new Error('Invalid recording cursor');
  const cursor = value as PersistedSession;
  if (
    cursor.sessionId !== sessionId ||
    !Number.isSafeInteger(cursor.nextChunkIndex) ||
    cursor.nextChunkIndex < 0 ||
    !Number.isFinite(cursor.startedAt) ||
    (cursor.captureIntegrityError !== undefined && typeof cursor.captureIntegrityError !== 'string')
  )
    throw new Error('Invalid recording cursor');
  return cursor;
}

/**
 * The caller supplies a context fetched from the authenticated session-owned
 * recovery-key route. No key registry or plaintext write fallback is used.
 */
export function createSessionAudioStore(context: RecoveryContext): SessionAudioStore {
  if (!context.accountId || !context.sessionId || context.closed)
    throw new Error('Secure audio recovery is unavailable');
  const { accountId, sessionId } = context;
  let closed = false;
  let dbPromise: Promise<IDBDatabase> | undefined;
  let database: IDBDatabase | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let migrated = false;
  const transactions = new Set<IDBTransaction>();
  const cursorKey = [accountId, sessionId];
  const chunkKey = (index: number) => [accountId, sessionId, index];

  function assertOpen(id = sessionId) {
    if (closed || context.closed) throw new Error('Secure audio recovery is closed');
    if (id !== sessionId) throw new Error('This audio recovery belongs to a different session');
  }

  async function openDb(): Promise<IDBDatabase> {
    assertOpen();
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        let blocked = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LEGACY_CHUNKS)) {
            const store = db.createObjectStore(LEGACY_CHUNKS, {
              keyPath: ['sessionId', 'chunkIndex'],
            });
            store.createIndex('sessionId', 'sessionId', { unique: false });
          }
          if (!db.objectStoreNames.contains(LEGACY_CURSORS))
            db.createObjectStore(LEGACY_CURSORS, { keyPath: 'sessionId' });
          if (!db.objectStoreNames.contains(CHUNKS)) {
            const store = db.createObjectStore(CHUNKS, {
              keyPath: ['accountId', 'sessionId', 'chunkIndex'],
            });
            store.createIndex('ownerSession', ['accountId', 'sessionId'], { unique: false });
          }
          if (!db.objectStoreNames.contains(CURSORS))
            db.createObjectStore(CURSORS, { keyPath: ['accountId', 'sessionId'] });
        };
        request.onblocked = () => {
          blocked = true;
          reject(
            new Error(
              'Close older recording tabs, then reopen this session to secure audio recovery.',
            ),
          );
        };
        request.onerror = () => reject(request.error ?? new Error('Audio storage unavailable'));
        request.onsuccess = () => {
          const db = request.result;
          if (blocked || closed || context.closed) {
            db.close();
            reject(new Error('Secure audio recovery is closed'));
            return;
          }
          database = db;
          db.onversionchange = () => {
            db.close();
            closed = true;
          };
          resolve(db);
        };
      });
    }
    const db = await dbPromise;
    assertOpen();
    return db;
  }

  async function read<T>(
    storeName: string,
    request: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDb();
    assertOpen();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      transactions.add(transaction);
      const result = request(transaction.objectStore(storeName));
      transaction.oncomplete = () => {
        transactions.delete(transaction);
        try {
          assertOpen();
          resolve(result.result);
        } catch (error) {
          reject(error);
        }
      };
      const fail = () => {
        transactions.delete(transaction);
        reject(transaction.error ?? new Error('Audio storage transaction aborted'));
      };
      transaction.onabort = fail;
      transaction.onerror = fail;
    });
  }

  async function compareAndSwap(changes: Change[]): Promise<boolean> {
    const db = await openDb();
    assertOpen();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([...new Set(changes.map((c) => c.store))], 'readwrite');
      transactions.add(transaction);
      let remaining = changes.length;
      let matches = true;
      let applied = false;
      transaction.oncomplete = () => {
        transactions.delete(transaction);
        resolve(applied);
      };
      const fail = () => {
        transactions.delete(transaction);
        reject(transaction.error ?? new Error('Audio storage transaction aborted'));
      };
      transaction.onabort = fail;
      transaction.onerror = fail;
      for (const change of changes) {
        const request = transaction.objectStore(change.store).get(change.key);
        request.onsuccess = () => {
          matches &&= equal(request.result, change.before);
          if (--remaining || !matches) return;
          if (closed || context.closed) {
            transaction.abort();
            return;
          }
          // No awaited work is allowed here: WebCrypto ran before opening this tx.
          for (const item of changes) {
            const store = transaction.objectStore(item.store);
            if (item.after === null) store.delete(item.key);
            else if (item.after !== undefined) store.put(item.after);
          }
          applied = true;
        };
      }
    });
  }

  function aad(kind: 'chunk' | 'cursor', index: number) {
    return new TextEncoder().encode(
      JSON.stringify(['mind-audio', 2, kind, accountId, sessionId, index]),
    );
  }

  async function encrypt(
    kind: 'chunk' | 'cursor',
    index: number,
    value: unknown,
  ): Promise<Envelope> {
    assertOpen();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(kind, index) },
      context.key,
      new TextEncoder().encode(JSON.stringify(value)),
    );
    assertOpen();
    return {
      version: 2,
      accountId,
      sessionId,
      chunkIndex: index,
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
    };
  }

  async function decrypt(
    kind: 'chunk' | 'cursor',
    index: number,
    value: Envelope,
  ): Promise<unknown> {
    assertOpen();
    if (
      value.version !== 2 ||
      value.accountId !== accountId ||
      value.sessionId !== sessionId ||
      value.chunkIndex !== index ||
      typeof value.iv !== 'string' ||
      typeof value.ciphertext !== 'string'
    )
      throw new Error('This saved audio belongs to a different recovery context');
    const iv = decode(value.iv);
    if (iv.length !== 12) throw new Error('Invalid saved audio nonce');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(kind, index) },
      context.key,
      decode(value.ciphertext),
    );
    assertOpen();
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  }

  const getChunk = (index: number) =>
    read<Envelope | undefined>(CHUNKS, (s) => s.get(chunkKey(index)));
  const getCursor = () => read<Envelope | undefined>(CURSORS, (s) => s.get(cursorKey));
  const listEnvelopes = () =>
    read<Envelope[]>(CHUNKS, (s) => s.index('ownerSession').getAll(IDBKeyRange.only(cursorKey)));
  async function unpackChunk(envelope: Envelope): Promise<PersistedChunk> {
    const value = (await decrypt('chunk', envelope.chunkIndex, envelope)) as Record<
      string,
      unknown
    >;
    if (!value || typeof value.bytes !== 'string') throw new Error('Invalid saved audio');
    const chunk = chunkValue({ ...value, bytes: decode(value.bytes) }, sessionId);
    if (chunk.chunkIndex !== envelope.chunkIndex) throw new Error('Invalid saved audio position');
    return chunk;
  }
  const packChunk = (chunk: PersistedChunk) =>
    encrypt('chunk', chunk.chunkIndex, { ...chunk, bytes: encode(chunk.bytes) });
  const unpackCursor = async (envelope: Envelope) =>
    cursorValue(await decrypt('cursor', -1, envelope), sessionId);

  async function migrateLegacy(): Promise<void> {
    if (migrated) return;
    const oldChunks = await read<PersistedChunk[]>(LEGACY_CHUNKS, (s) =>
      s.index('sessionId').getAll(IDBKeyRange.only(sessionId)),
    );
    for (const raw of oldChunks) {
      const chunk = chunkValue(raw, sessionId);
      const existing = await getChunk(chunk.chunkIndex);
      if (existing && !sameAudioChunk(await unpackChunk(existing), chunk))
        throw new Error(CONFLICT);
      const replacement = existing ?? (await packChunk(chunk));
      // Atomic commit: either the exact raw copy becomes durably encrypted and
      // is removed, or both the original copy and the other tab's work survive.
      const moved = await compareAndSwap([
        { store: CHUNKS, key: chunkKey(chunk.chunkIndex), before: existing, after: replacement },
        { store: LEGACY_CHUNKS, key: [sessionId, chunk.chunkIndex], before: raw, after: null },
      ]);
      if (!moved) throw new Error(CONFLICT);
    }
    const rawCursor = await read<PersistedSession | undefined>(LEGACY_CURSORS, (s) =>
      s.get(sessionId),
    );
    // A browser may have committed a chunk before crashing during its separate
    // cursor write. Recover the high-water from encrypted chunks too, including
    // chunks migrated by a previously interrupted migration attempt.
    const savedChunks = await Promise.all((await listEnvelopes()).map(unpackChunk));
    if (rawCursor || savedChunks.length) {
      const existing = await getCursor();
      const current = existing ? await unpackCursor(existing) : null;
      const legacy = rawCursor ? cursorValue(rawCursor, sessionId) : current;
      const recovered: PersistedSession = {
        sessionId,
        startedAt: legacy?.startedAt ?? savedChunks[0]!.enqueuedAt,
        nextChunkIndex: Math.max(
          legacy?.nextChunkIndex ?? 0,
          ...savedChunks.map((c) => c.chunkIndex + 1),
        ),
        ...(legacy?.captureIntegrityError
          ? { captureIntegrityError: legacy.captureIntegrityError }
          : {}),
      };
      const merged = mergeCursor(current, recovered);
      if (!rawCursor && equal(current, merged)) {
        migrated = true;
        return;
      }
      const replacement = await encrypt('cursor', -1, merged);
      if (
        !(await compareAndSwap([
          { store: CURSORS, key: cursorKey, before: existing, after: replacement },
          {
            store: LEGACY_CURSORS,
            key: sessionId,
            before: rawCursor,
            ...(rawCursor ? { after: null } : {}),
          },
        ]))
      )
        throw new Error(CONFLICT);
    }
    migrated = true;
  }

  function run<T>(work: () => Promise<T>): Promise<T> {
    const perform = async () => {
      assertOpen();
      await migrateLegacy();
      assertOpen();
      return work();
    };
    const execute = async () => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request(`mind-audio:2:${JSON.stringify(cursorKey)}`, perform);
      return perform();
    };
    const next = pending.then(execute, execute);
    pending = next.catch(() => {});
    return next;
  }

  function mergeCursor(
    current: PersistedSession | null,
    incoming: PersistedSession,
  ): PersistedSession {
    return {
      ...incoming,
      nextChunkIndex: Math.max(current?.nextChunkIndex ?? 0, incoming.nextChunkIndex),
      startedAt: current?.startedAt ?? incoming.startedAt,
      ...(current?.captureIntegrityError
        ? { captureIntegrityError: current.captureIntegrityError }
        : {}),
    };
  }

  async function mutateChunk(
    index: number,
    expected: PersistedChunk | undefined,
    change: (current: PersistedChunk) => PersistedChunk | null,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await getChunk(index);
      if (!before) return;
      const current = await unpackChunk(before);
      if (expected && !sameAudioChunk(current, expected)) return;
      const next = change(current);
      const after = next ? await packChunk(next) : null;
      if (await compareAndSwap([{ store: CHUNKS, key: chunkKey(index), before, after }])) return;
    }
    throw new Error(CONFLICT);
  }

  return {
    chunks: {
      async insert(chunk) {
        assertOpen(chunk.sessionId);
        const input = chunkValue({ ...chunk, bytes: new Uint8Array(chunk.bytes) }, sessionId);
        return run(async () => {
          for (let attempt = 0; attempt < 8; attempt++) {
            const before = await getChunk(input.chunkIndex);
            const cursor = await getCursor();
            if (cursor && (await unpackCursor(cursor)).captureIntegrityError === DISCARDED)
              throw new Error(DISCARDED);
            const previous = before ? await unpackChunk(before) : null;
            if (previous && !sameAudioChunk(previous, input)) throw new Error(CONFLICT);
            const after = await packChunk(
              previous
                ? { ...input, attempts: Math.max(previous.attempts, input.attempts) }
                : input,
            );
            if (
              await compareAndSwap([
                { store: CHUNKS, key: chunkKey(input.chunkIndex), before, after },
                { store: CURSORS, key: cursorKey, before: cursor },
              ])
            )
              return;
          }
          throw new Error(CONFLICT);
        });
      },
      async remove(id, index, acknowledged) {
        assertOpen(id);
        chunkValue(acknowledged, sessionId);
        if (acknowledged.chunkIndex !== index) throw new Error('Invalid audio acknowledgement');
        return run(() => mutateChunk(index, acknowledged, () => null));
      },
      async listForSession(id) {
        assertOpen(id);
        return run(async () => {
          const chunks = await Promise.all((await listEnvelopes()).map(unpackChunk));
          assertOpen();
          return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        });
      },
      async incrementAttempts(id, index, httpStatus, attempted) {
        assertOpen(id);
        if (attempted && chunkValue(attempted, sessionId).chunkIndex !== index)
          throw new Error('Invalid audio attempt');
        return run(() =>
          mutateChunk(index, attempted, (current) => ({
            ...current,
            attempts: current.attempts + 1,
            lastHttpStatus: httpStatus,
          })),
        );
      },
      async resetRetryableAttempts(id) {
        assertOpen(id);
        return run(async () => {
          for (const envelope of await listEnvelopes()) {
            const chunk = await unpackChunk(envelope);
            await mutateChunk(chunk.chunkIndex, chunk, (current) => {
              const status = current.lastHttpStatus;
              return status && status >= 400 && status < 500 && ![401, 408, 429].includes(status)
                ? current
                : { ...current, attempts: 0 };
            });
          }
        });
      },
    },
    cursor: {
      async saveCursor(record) {
        assertOpen(record.sessionId);
        const input = { ...cursorValue(record, sessionId) };
        return run(async () => {
          for (let attempt = 0; attempt < 8; attempt++) {
            const before = await getCursor();
            const current = before ? await unpackCursor(before) : null;
            const after = await encrypt('cursor', -1, mergeCursor(current, input));
            if (await compareAndSwap([{ store: CURSORS, key: cursorKey, before, after }])) return;
          }
          throw new Error(CONFLICT);
        });
      },
      async getCursor(id) {
        assertOpen(id);
        return run(async () => {
          const envelope = await getCursor();
          return envelope ? unpackCursor(envelope) : null;
        });
      },
      async clear(id) {
        assertOpen(id);
        return run(async () => {
          const before = await getCursor();
          if (before && (await unpackCursor(before)).captureIntegrityError)
            throw new Error('Recording integrity must be reviewed before clearing recovery');
          if ((await listEnvelopes()).length)
            throw new Error('Unsaved audio must be recovered before clearing its cursor');
          if (!(await compareAndSwap([{ store: CURSORS, key: cursorKey, before, after: null }])))
            throw new Error(CONFLICT);
        });
      },
    },
    async discardPending() {
      return run(async () => {
        const snapshots = await listEnvelopes();
        const chunks = await Promise.all(snapshots.map(unpackChunk));
        const before = await getCursor();
        const current = before ? await unpackCursor(before) : null;
        const after = await encrypt('cursor', -1, {
          sessionId,
          startedAt: current?.startedAt ?? chunks[0]?.enqueuedAt ?? Date.now(),
          nextChunkIndex: Math.max(
            current?.nextChunkIndex ?? 0,
            ...chunks.map((c) => c.chunkIndex + 1),
          ),
          captureIntegrityError: DISCARDED,
        });
        const changes: Change[] = snapshots.map((envelope) => ({
          store: CHUNKS,
          key: chunkKey(envelope.chunkIndex),
          before: envelope,
          after: null,
        }));
        changes.push({ store: CURSORS, key: cursorKey, before, after });
        // Never retry a discard against new snapshots: confirmation cannot
        // authorize deletion of another tab's subsequently replaced recording.
        if (!(await compareAndSwap(changes))) throw new Error(CONFLICT);
      });
    },
    close() {
      closed = true;
      context.closed = true;
      for (const transaction of transactions) {
        try {
          transaction.abort();
        } catch {
          /* Already committed. */
        }
      }
      database?.close();
    },
  };
}
