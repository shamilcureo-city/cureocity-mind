import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecoveryContext } from '../live-recovery-draft';
import type { PersistedChunk } from './idb-chunk-store';
import { createSessionAudioStore } from './session-audio-store';

type Stored = Record<string, unknown>;
type StoreDefinition = {
  keyPath: string | string[];
  indexes: Map<string, string | string[]>;
  rows: Map<string, Stored>;
};
type Request = { result?: unknown; error?: Error; onsuccess?: () => void; onerror?: () => void };
const copy = <T>(value: T): T => structuredClone(value);
const keyFor = (value: Stored, keyPath: string | string[]) =>
  JSON.stringify(Array.isArray(keyPath) ? keyPath.map((part) => value[part]) : value[keyPath]);

/**
 * Controlled IDB boundary: serialized transactions, request callbacks and
 * commit/abort are separate events. Real WebCrypto is used, and every call is
 * asserted to happen outside an active transaction.
 */
function fixtureDatabase() {
  const stores = new Map<string, StoreDefinition>();
  let version = 1;
  let active = false;
  let writing = false;
  let abortNextWrite = false;
  let beforeNextWrite: (() => void) | undefined;
  const jobs: Array<() => void> = [];
  const define = (name: string, keyPath: string | string[]) => {
    const definition = {
      keyPath,
      indexes: new Map<string, string | string[]>(),
      rows: new Map<string, Stored>(),
    };
    stores.set(name, definition);
    return {
      createIndex: (index: string, path: string | string[]) => definition.indexes.set(index, path),
    };
  };
  define('pending-chunks', ['sessionId', 'chunkIndex']).createIndex('sessionId', 'sessionId');
  define('sessions', 'sessionId');
  const pump = () => {
    if (active || !jobs.length) return;
    active = true;
    jobs.shift()!();
  };

  const database = {
    close: vi.fn(),
    onversionchange: undefined as (() => void) | undefined,
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options: { keyPath: string | string[] }) =>
      define(name, options.keyPath),
    transaction: (names: string | string[], mode: string) => {
      let running = false;
      let finished = false;
      let aborted = false;
      let requests = 0;
      const queued: Array<() => void> = [];
      const local = new Map<string, StoreDefinition>();
      const transaction = {
        error: null as Error | null,
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        abort: () => {
          if (finished) throw new Error('Already committed');
          aborted = true;
          transaction.error = new Error('Transaction aborted');
          if (running) queueMicrotask(finish);
        },
        objectStore: (name: string) => {
          const enqueue = (fn: () => unknown): Request => {
            const request: Request = {};
            if (finished) throw new Error('TransactionInactiveError');
            requests++;
            const work = () =>
              queueMicrotask(() => {
                if (aborted) return finish();
                try {
                  request.result = copy(fn());
                  request.onsuccess?.();
                } catch (error) {
                  aborted = true;
                  transaction.error = error as Error;
                  request.onerror?.();
                }
                requests--;
                if (!requests) queueMicrotask(finish);
              });
            if (running) work();
            else queued.push(work);
            return request;
          };
          return {
            get: (key: unknown) => enqueue(() => local.get(name)!.rows.get(JSON.stringify(key))),
            put: (value: Stored) =>
              enqueue(() => {
                const store = local.get(name)!;
                const key = keyFor(value, store.keyPath);
                store.rows.set(key, copy(value));
                return JSON.parse(key) as unknown;
              }),
            delete: (key: unknown) =>
              enqueue(() => {
                local.get(name)!.rows.delete(JSON.stringify(key));
              }),
            index: (index: string) => ({
              getAll: (range: { only: unknown }) =>
                enqueue(() => {
                  const store = local.get(name)!;
                  const path = store.indexes.get(index)!;
                  return [...store.rows.values()].filter(
                    (value) => keyFor(value, path) === JSON.stringify(range.only),
                  );
                }),
            }),
          };
        },
      };
      const finish = () => {
        if (!running || finished || (!aborted && requests)) return;
        finished = true;
        if (mode === 'readwrite' && abortNextWrite) {
          abortNextWrite = false;
          aborted = true;
          transaction.error = new Error('Simulated durable commit failure');
        }
        if (!aborted && mode === 'readwrite')
          for (const [name, value] of local) stores.set(name, value);
        active = false;
        writing = false;
        if (aborted) transaction.onabort?.();
        else transaction.oncomplete?.();
        queueMicrotask(pump);
      };
      jobs.push(() => {
        if (mode === 'readwrite') {
          const hook = beforeNextWrite;
          beforeNextWrite = undefined;
          hook?.();
        }
        for (const name of typeof names === 'string' ? [names] : names)
          local.set(name, copy(stores.get(name)!));
        running = true;
        writing = mode === 'readwrite';
        if (aborted) return finish();
        for (const work of queued) work();
      });
      queueMicrotask(pump);
      return transaction;
    },
  };

  vi.stubGlobal('indexedDB', {
    open: (_name: string, requested: number) => {
      const request: Request & { onupgradeneeded?: () => void } = {};
      queueMicrotask(() => {
        request.result = database;
        if (requested > version) {
          version = requested;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  });
  vi.stubGlobal('IDBKeyRange', { only: (only: unknown) => ({ only }) });
  vi.stubGlobal('navigator', {}); // CAS must work without Web Locks.

  return {
    get active() {
      return active;
    },
    get writing() {
      return writing;
    },
    rows: (name: string) => [...(stores.get(name)?.rows.values() ?? [])],
    seed(name: string, value: unknown) {
      const store = stores.get(name)!;
      store.rows.set(keyFor(value as Stored, store.keyPath), copy(value as Stored));
    },
    failCommit() {
      abortNextWrite = true;
    },
    beforeWrite(hook: () => void) {
      beforeNextWrite = hook;
    },
  };
}

const chunk = (index = 0, bytes = [1, 2, 3, 4]): PersistedChunk => ({
  sessionId: 'session-one',
  chunkIndex: index,
  mimeType: 'audio/pcm',
  sampleRate: 16000,
  durationMs: 1000,
  bytes: new Uint8Array(bytes),
  enqueuedAt: 123,
  attempts: 0,
});
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const context = (account = 'account-one', session = 'session-one', secret = key) =>
  createRecoveryContext(account, session, secret);
let db: ReturnType<typeof fixtureDatabase>;
beforeEach(() => {
  db = fixtureDatabase();
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((...args) => {
    expect(db.active, 'WebCrypto must not run inside an IDB transaction').toBe(false);
    return encrypt(...args);
  });
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation((...args) => {
    expect(db.active, 'WebCrypto must not run inside an IDB transaction').toBe(false);
    return decrypt(...args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session-scoped encrypted browser audio', () => {
  it('stores only encrypted payloads, persists/reopens them and separates account/session scopes', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert(chunk());
    await store.cursor.saveCursor({ sessionId: 'session-one', nextChunkIndex: 1, startedAt: 123 });
    const [record] = db.rows('pending-chunks-v2');
    expect(record).toMatchObject({
      version: 2,
      accountId: 'account-one',
      sessionId: 'session-one',
      chunkIndex: 0,
    });
    expect(record).not.toHaveProperty('bytes');
    expect(record).not.toHaveProperty('mimeType');
    expect(record).not.toHaveProperty('durationMs');
    expect(db.rows('pending-chunks')).toEqual([]);
    const reopened = createSessionAudioStore(await context());
    expect(await reopened.chunks.listForSession('session-one')).toEqual([chunk()]);
    expect(await reopened.cursor.getCursor('session-one')).toEqual({
      sessionId: 'session-one',
      nextChunkIndex: 1,
      startedAt: 123,
    });
    expect(
      await createSessionAudioStore(await context('other')).chunks.listForSession('session-one'),
    ).toEqual([]);
    await expect(store.chunks.listForSession('different-session')).rejects.toThrow(
      'different session',
    );
    await expect(
      store.chunks.insert({ ...chunk(), sessionId: 'different-session' }),
    ).rejects.toThrow('different session');
  });

  it('refuses tampered context, wrong keys and changed ciphertext without deleting the copy', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert(chunk());
    const original = copy(db.rows('pending-chunks-v2')[0]!);
    const wrong = createSessionAudioStore(
      await context('account-one', 'session-one', btoa('x'.repeat(32))),
    );
    await expect(wrong.chunks.listForSession('session-one')).rejects.toThrow();
    db.seed('pending-chunks-v2', { ...original, accountId: 'other' });
    await expect(
      createSessionAudioStore(await context('other')).chunks.listForSession('session-one'),
    ).rejects.toThrow();
    db.seed('pending-chunks-v2', {
      ...original,
      ciphertext: (original.ciphertext as string).slice(0, -4) + 'AAAA',
    });
    await expect(store.chunks.listForSession('session-one')).rejects.toThrow();
    expect(db.rows('pending-chunks-v2')).toHaveLength(2);
  });

  it('migrates only the authorized session raw chunks and cursor after durable encrypted commit', async () => {
    db.seed('pending-chunks', chunk());
    db.seed('pending-chunks', { ...chunk(), sessionId: 'other-session' });
    db.seed('sessions', {
      sessionId: 'session-one',
      nextChunkIndex: 3,
      startedAt: 100,
      captureIntegrityError: 'Missing tail',
    });
    const store = createSessionAudioStore(await context());
    expect(await store.chunks.listForSession('session-one')).toEqual([chunk()]);
    expect(db.rows('pending-chunks').map((row) => row.sessionId)).toEqual(['other-session']);
    expect(db.rows('sessions')).toEqual([]);
    expect(await store.cursor.getCursor('session-one')).toEqual({
      sessionId: 'session-one',
      nextChunkIndex: 3,
      startedAt: 100,
      captureIntegrityError: 'Missing tail',
    });
  });

  it('preserves the only raw copy and cursor if encryption or commit fails', async () => {
    db.seed('pending-chunks', chunk());
    db.seed('sessions', { sessionId: 'session-one', nextChunkIndex: 1, startedAt: 123 });
    const store = createSessionAudioStore(await context());
    vi.mocked(crypto.subtle.encrypt).mockRejectedValueOnce(new Error('crypto unavailable'));
    await expect(store.chunks.listForSession('session-one')).rejects.toThrow('crypto unavailable');
    expect(db.rows('pending-chunks')).toEqual([chunk()]);
    db.failCommit();
    await expect(store.chunks.listForSession('session-one')).rejects.toThrow('commit failure');
    expect(db.rows('pending-chunks')).toEqual([chunk()]);
    expect(db.rows('pending-chunks-v2')).toEqual([]);
    expect(db.rows('sessions')).toHaveLength(1);
    expect(await store.chunks.listForSession('session-one')).toEqual([chunk()]);
  });

  it('reconstructs missing or stale cursors from pending chunks before resuming capture', async () => {
    db.seed('pending-chunks', chunk(7));
    db.seed('sessions', { sessionId: 'session-one', nextChunkIndex: 0, startedAt: 100 });
    const store = createSessionAudioStore(await context());
    expect(await store.cursor.getCursor('session-one')).toEqual({
      sessionId: 'session-one',
      nextChunkIndex: 8,
      startedAt: 100,
    });
    const other = createSessionAudioStore(await context('account-two', 'session-two'));
    await other.chunks.insert({ ...chunk(3), sessionId: 'session-two' });
    other.close();
    const reopened = createSessionAudioStore(await context('account-two', 'session-two'));
    expect(await reopened.cursor.getCursor('session-two')).toEqual({
      sessionId: 'session-two',
      nextChunkIndex: 4,
      startedAt: 123,
    });
  });

  it('preserves conflicting legacy bytes rather than removing them after a different encrypted capture', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert(chunk());
    const conflicting = chunk(0, [9, 8, 7, 6]);
    db.seed('pending-chunks', conflicting);
    const reopened = createSessionAudioStore(await context());
    await expect(reopened.chunks.listForSession('session-one')).rejects.toThrow(
      'Another recording tab',
    );
    expect(db.rows('pending-chunks')).toEqual([conflicting]);
    expect(await store.chunks.listForSession('session-one')).toEqual([chunk()]);
  });

  it('refuses ordinal collisions and late acknowledgements cannot mutate replacement audio', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert(chunk());
    const replacement = chunk(0, [9, 8, 7, 6]);
    await expect(store.chunks.insert(replacement)).rejects.toThrow('Another recording tab');
    await store.chunks.remove('session-one', 0, chunk());
    await store.chunks.insert(replacement);
    await store.chunks.remove('session-one', 0, chunk());
    await store.chunks.incrementAttempts('session-one', 0, 503, chunk());
    expect(await store.chunks.listForSession('session-one')).toEqual([replacement]);
    await store.chunks.incrementAttempts('session-one', 0, 503, replacement);
    expect((await store.chunks.listForSession('session-one'))[0]!.attempts).toBe(1);
  });

  it('protects concurrent inserts without Web Locks', async () => {
    const a = createSessionAudioStore(await context());
    const b = createSessionAudioStore(await context());
    await Promise.all([
      a.chunks.listForSession('session-one'),
      b.chunks.listForSession('session-one'),
    ]);
    const results = await Promise.allSettled([
      a.chunks.insert(chunk()),
      b.chunks.insert(chunk(0, [9, 8, 7, 6])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await a.chunks.listForSession('session-one')).toHaveLength(1);
  });

  it('preserves cursor high-water/integrity and retries only retryable failures', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert({ ...chunk(), attempts: 6, lastHttpStatus: 503 });
    await store.chunks.insert({ ...chunk(1), attempts: 6, lastHttpStatus: 409 });
    await store.chunks.resetRetryableAttempts('session-one');
    expect((await store.chunks.listForSession('session-one')).map((c) => c.attempts)).toEqual([
      0, 6,
    ]);
    await store.cursor.saveCursor({
      sessionId: 'session-one',
      nextChunkIndex: 9,
      startedAt: 100,
      captureIntegrityError: 'Missing tail',
    });
    await store.cursor.saveCursor({ sessionId: 'session-one', nextChunkIndex: 1, startedAt: 999 });
    expect(await store.cursor.getCursor('session-one')).toEqual({
      sessionId: 'session-one',
      nextChunkIndex: 9,
      startedAt: 100,
      captureIntegrityError: 'Missing tail',
    });
    await expect(store.cursor.clear('session-one')).rejects.toThrow('integrity');
  });

  it('discards only after explicit invocation and permanently marks that recording incomplete', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert({ ...chunk(7), enqueuedAt: 0 });
    expect(await store.chunks.listForSession('session-one')).toHaveLength(1); // No automatic age purge.
    await store.discardPending();
    expect(await store.chunks.listForSession('session-one')).toEqual([]);
    expect(await store.cursor.getCursor('session-one')).toEqual({
      sessionId: 'session-one',
      nextChunkIndex: 8,
      startedAt: 0,
      captureIntegrityError:
        'Unsaved audio was discarded. This recording cannot be finalized as complete.',
    });
    await store.cursor.saveCursor({ sessionId: 'session-one', nextChunkIndex: 0, startedAt: 999 });
    await expect(store.cursor.clear('session-one')).rejects.toThrow('integrity');
    await expect(store.chunks.insert(chunk(8))).rejects.toThrow('discarded');
  });

  it('refuses discard when a snapshot was replaced before commit without deleting either part', async () => {
    const store = createSessionAudioStore(await context());
    await store.chunks.insert(chunk());
    await store.chunks.insert(chunk(1));
    const original = db.rows('pending-chunks-v2')[0]!;
    db.beforeWrite(() =>
      db.seed('pending-chunks-v2', { ...original, ciphertext: 'replacement-from-another-tab' }),
    );
    await expect(store.discardPending()).rejects.toThrow('Another recording tab');
    expect(db.rows('pending-chunks-v2')).toHaveLength(2);
    expect(db.rows('sessions-v2')).toEqual([]);
  });

  it('rejects closed contexts and late encryption without writing or falling back to raw audio', async () => {
    const recovery = await context();
    const store = createSessionAudioStore(recovery);
    await store.chunks.listForSession('session-one');
    const real = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    vi.mocked(crypto.subtle.encrypt).mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return real(...args);
    });
    const writing = store.chunks.insert(chunk());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    store.close();
    release();
    await expect(writing).rejects.toThrow('closed');
    await expect(store.chunks.listForSession('session-one')).rejects.toThrow('closed');
    expect(db.rows('pending-chunks-v2')).toEqual([]);
    expect(db.rows('pending-chunks')).toEqual([]);
  });
});
