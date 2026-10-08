import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserRecoveryStorage,
  clearRecoveryDraftAfterDurableSave,
  createRecoveryContext,
  encryptedRecoveryDraftKey,
  fetchRecoveryContext,
  hasUniqueUnsavedContent,
  loadRecoveryDraft,
  recoveryDraftKey,
  saveRecoveryDraft,
  shouldResumeRecovery,
  RECOVERY_AUTO_RESTORE_TTL_MS,
  RECOVERY_KEY_TIMEOUT_MS,
  type RecoveryStorage,
} from './live-recovery-draft';

function memoryStorage(): RecoveryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}
const rawKey = Buffer.alloc(32, 17).toString('base64');
const contextFor = (account = 'psy-1', session = 'session-1', key = rawKey) =>
  createRecoveryContext(account, session, key);
const draft = {
  version: 1 as const,
  sessionId: 'session-1',
  savedAt: new Date().toISOString(),
  utterances: [{ id: 'u1', speaker: 'patient', text: 'I feel safer', tStartMs: 0, tEndMs: 900 }],
  transcript: 'Client: I feel safer',
  captureMode: 'LIVE' as const,
  durable: false,
  captureIncomplete: true,
  captureIncompleteReason: 'connection_lost' as const,
};
const storedKey = encryptedRecoveryDraftKey('psy-1', 'session-1');
const nativeLocks = typeof navigator === 'undefined' ? undefined : navigator.locks;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  // Exercise the no-Web-Locks compare/check fallback deterministically.
  // Node 24 exposes native Web Locks; holding one while waiting for a second
  // writer in the delayed-encryption race fixture would deadlock the test.
  // Browser-lock behavior is exercised explicitly below.
  vi.stubGlobal('navigator', {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('encrypted live recovery draft', () => {
  it('writes only authenticated ciphertext and restores warnings/integrity under the same account', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    await loadRecoveryDraft(storage, context);
    expect(context.key.extractable).toBe(false);
    expect(await saveRecoveryDraft(storage, context, draft)).toBe(true);
    const ciphertext = storage.getItem(storedKey)!;
    expect(ciphertext).not.toContain('safer');
    expect(ciphertext).not.toContain('connection_lost');
    expect(ciphertext).not.toContain(rawKey);
    expect(storage.getItem(recoveryDraftKey('session-1'))).toBeNull();
    expect(await loadRecoveryDraft(storage, await contextFor())).toEqual({
      status: 'ready',
      draft,
    });
    expect(hasUniqueUnsavedContent(draft)).toBe(true);
  });

  it('uses a fresh nonce for every save of identical content', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    await loadRecoveryDraft(storage, context);
    await saveRecoveryDraft(storage, context, draft);
    const first = storage.getItem(storedKey);
    await saveRecoveryDraft(storage, context, draft);
    expect(storage.getItem(storedKey)).not.toEqual(first);
  });

  it.each(['account', 'session', 'key', 'tamper'])(
    'cannot decrypt a copied envelope with a different %s',
    async (difference) => {
      const storage = memoryStorage();
      const original = await contextFor();
      await loadRecoveryDraft(storage, original);
      await saveRecoveryDraft(storage, original, draft);
      const other = await contextFor(
        difference === 'account' ? 'psy-2' : 'psy-1',
        difference === 'session' ? 'session-2' : 'session-1',
        difference === 'key' ? Buffer.alloc(32, 18).toString('base64') : rawKey,
      );
      let raw = storage.getItem(storedKey)!;
      if (difference === 'tamper') {
        const envelope = JSON.parse(raw);
        envelope.ciphertext = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`;
        raw = JSON.stringify(envelope);
      }
      const otherKey = encryptedRecoveryDraftKey(other.accountId, other.sessionId);
      storage.setItem(otherKey, raw);
      expect(await loadRecoveryDraft(storage, other)).toEqual({
        status: 'unavailable',
        draft: null,
      });
      expect(
        await saveRecoveryDraft(storage, other, { ...draft, sessionId: other.sessionId }),
      ).toBe(false);
      expect(await clearRecoveryDraftAfterDurableSave(storage, other, true)).toBe(false);
      expect(storage.getItem(otherKey)).toBe(raw);
    },
  );

  it('never overwrites unread old copies before loading them', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    expect(await saveRecoveryDraft(storage, context, draft)).toBe(false);
  });

  it('requires explicit recovery after the auto-restore TTL without deleting the encrypted copy', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    await loadRecoveryDraft(storage, context);
    await saveRecoveryDraft(storage, context, draft);
    const now = Date.parse(draft.savedAt) + RECOVERY_AUTO_RESTORE_TTL_MS + 1;
    expect(await loadRecoveryDraft(storage, context, { now })).toEqual({
      status: 'expired',
      draft: null,
    });
    expect(await saveRecoveryDraft(storage, context, draft)).toBe(false);
    expect(storage.getItem(storedKey)).not.toBeNull();
    expect(await loadRecoveryDraft(storage, context, { now, allowExpired: true })).toEqual({
      status: 'ready',
      draft,
    });
  });

  it('migrates legacy plaintext only after verified encrypted storage and retains the same content', async () => {
    const storage = memoryStorage();
    storage.setItem(recoveryDraftKey('session-1'), JSON.stringify(draft));
    expect(await loadRecoveryDraft(storage, await contextFor())).toEqual({
      status: 'ready',
      draft,
    });
    expect(storage.getItem(recoveryDraftKey('session-1'))).toBeNull();
    expect(storage.getItem(storedKey)).not.toContain('safer');
  });

  it.each(['quota', 'silently-dropped-write', 'crypto'])(
    'preserves plaintext if migration fails due to %s',
    async (failure) => {
      const storage = memoryStorage();
      const legacy = JSON.stringify(draft);
      storage.setItem(recoveryDraftKey('session-1'), legacy);
      const context = await contextFor();
      if (failure === 'quota')
        storage.setItem = () => {
          throw new Error('full');
        };
      if (failure === 'silently-dropped-write') storage.setItem = () => {};
      if (failure === 'crypto')
        vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('unavailable'));
      expect(await loadRecoveryDraft(storage, context)).toEqual({
        status: 'unavailable',
        draft: null,
      });
      expect(storage.getItem(recoveryDraftKey('session-1'))).toBe(legacy);
    },
  );

  it('retries plaintext removal after a partial migration without ever dropping different content', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    storage.setItem(recoveryDraftKey('session-1'), JSON.stringify(draft));
    const remove = storage.removeItem;
    storage.removeItem = () => {
      throw new Error('blocked');
    };
    expect((await loadRecoveryDraft(storage, context)).status).toBe('unavailable');
    storage.removeItem = remove;
    expect((await loadRecoveryDraft(storage, context)).status).toBe('ready');
    expect(storage.getItem(recoveryDraftKey('session-1'))).toBeNull();
    const differentLegacy = JSON.stringify({ ...draft, transcript: 'Different unsaved words' });
    storage.setItem(recoveryDraftKey('session-1'), differentLegacy);
    expect((await loadRecoveryDraft(storage, context)).status).toBe('unavailable');
    expect(await clearRecoveryDraftAfterDurableSave(storage, context, true)).toBe(false);
    expect(storage.getItem(recoveryDraftKey('session-1'))).toBe(differentLegacy);
    expect(storage.getItem(storedKey)).not.toBeNull();
  });

  it('reports disabled localStorage without falling back to plaintext', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('disabled');
      },
    });
    const storage = browserRecoveryStorage();
    const context = await contextFor();
    expect((await loadRecoveryDraft(storage, context)).status).toBe('unavailable');
    expect(await saveRecoveryDraft(storage, context, draft)).toBe(false);
  });

  it('serializes saves and the durable acknowledgement so no pending save resurrects the draft', async () => {
    const storage = memoryStorage();
    const context = await contextFor();
    await loadRecoveryDraft(storage, context);
    const first = saveRecoveryDraft(storage, context, draft);
    const latest = saveRecoveryDraft(storage, context, { ...draft, transcript: 'Latest words' });
    expect(await first).toBe(true);
    expect(await latest).toBe(true);
    expect((await loadRecoveryDraft(storage, context)).draft?.transcript).toBe('Latest words');
    const pending = saveRecoveryDraft(storage, context, draft);
    expect(await clearRecoveryDraftAfterDurableSave(storage, context, false)).toBe(false);
    const acknowledged = clearRecoveryDraftAfterDurableSave(storage, context, true);
    const lateSave = saveRecoveryDraft(storage, context, draft);
    expect(await pending).toBe(true);
    expect(await acknowledged).toBe(true);
    expect(await lateSave).toBe(false);
    expect(storage.getItem(storedKey)).toBeNull();
  });

  it('only imports a key after an authenticated session-matching response and rejects cancellation', async () => {
    const controller = new AbortController();
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accountId: 'psy-1', sessionId: 'session-1', key: rawKey })),
      );
    expect((await fetchRecoveryContext('session-1', controller.signal, request)).accountId).toBe(
      'psy-1',
    );
    expect(request).toHaveBeenCalledWith(
      '/api/v1/auth/recovery-key?sessionId=session-1',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        signal: expect.any(AbortSignal),
      }),
    );
    request.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(fetchRecoveryContext('session-1', controller.signal, request)).rejects.toThrow();
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ accountId: 'psy-2', sessionId: 'different', key: rawKey })),
    );
    await expect(fetchRecoveryContext('session-1', controller.signal, request)).rejects.toThrow();
    controller.abort();
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ accountId: 'psy-1', sessionId: 'session-1', key: rawKey })),
    );
    await expect(fetchRecoveryContext('session-1', controller.signal, request)).rejects.toThrow(
      'cancelled',
    );
  });

  it('bounds a key request even when its transport ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const pending = fetchRecoveryContext('session-1', new AbortController().signal, request);
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(RECOVERY_KEY_TIMEOUT_MS);
    await rejected;
    expect((request.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(
      true,
    );
  });

  it('never clears or overwrites a newer copy written by another context', async () => {
    const storage = memoryStorage();
    const a = await contextFor();
    const b = await contextFor();
    await loadRecoveryDraft(storage, a);
    await loadRecoveryDraft(storage, b);
    await saveRecoveryDraft(storage, b, { ...draft, transcript: 'Newer tab words' });
    const newest = storage.getItem(storedKey);
    expect(await saveRecoveryDraft(storage, a, draft)).toBe(false);
    expect(await clearRecoveryDraftAfterDurableSave(storage, a, true)).toBe(false);
    expect(storage.getItem(storedKey)).toBe(newest);
  });

  it.each(['newer-write', 'unmount'])(
    'checks again after async encryption before writing over %s',
    async (change) => {
      const storage = memoryStorage();
      const a = await contextFor();
      const b = await contextFor();
      await loadRecoveryDraft(storage, a);
      await loadRecoveryDraft(storage, b);
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
        await wait;
        return encrypt(...args);
      });
      const pending = saveRecoveryDraft(storage, a, draft);
      await vi.waitFor(() => expect(delayed).toHaveBeenCalledOnce());
      if (change === 'newer-write')
        await saveRecoveryDraft(storage, b, { ...draft, transcript: 'Newer tab words' });
      else a.closed = true;
      const expected = storage.getItem(storedKey);
      release();
      expect(await pending).toBe(false);
      expect(storage.getItem(storedKey)).toBe(expected);
    },
  );

  it('uses an account/session-scoped Web Lock when the browser supports it', async () => {
    const request = vi.fn(async (_name, work) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    const storage = memoryStorage();
    const context = await contextFor();
    await loadRecoveryDraft(storage, context);
    await saveRecoveryDraft(storage, context, draft);
    expect(request).toHaveBeenCalledWith(storedKey, expect.any(Function));
  });

  it.skipIf(!nativeLocks)(
    'serializes real Web Locks without letting the waiting stale writer overwrite',
    async () => {
      vi.stubGlobal('navigator', { locks: nativeLocks });
      const storage = memoryStorage();
      const a = await contextFor();
      const b = await contextFor();
      await loadRecoveryDraft(storage, a);
      await loadRecoveryDraft(storage, b);
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      let release!: () => void;
      let entered!: () => void;
      const enteredEncryption = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
        entered();
        await wait;
        return encrypt(...args);
      });
      const first = saveRecoveryDraft(storage, a, draft);
      await enteredEncryption;
      const second = saveRecoveryDraft(storage, b, { ...draft, transcript: 'Stale second tab' });
      // Release the first holder before awaiting the second acquisition.
      release();
      expect(await first).toBe(true);
      expect(await second).toBe(false);
      expect(await loadRecoveryDraft(storage, await contextFor())).toEqual({
        status: 'ready',
        draft,
      });
    },
  );

  it('reports a browser lock refusal without an unhandled rejection or plaintext fallback', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const storage = memoryStorage();
    const context = await contextFor();
    expect((await loadRecoveryDraft(storage, context)).status).toBe('unavailable');
    expect(await saveRecoveryDraft(storage, context, draft)).toBe(false);
    expect(await clearRecoveryDraftAfterDurableSave(storage, context, true)).toBe(false);
    expect(storage.getItem(storedKey)).toBeNull();
  });

  it('retains resume and navigation guards for unsaved content', () => {
    expect(hasUniqueUnsavedContent({ ...draft, utterances: [], transcript: '' })).toBe(false);
    expect(hasUniqueUnsavedContent({ ...draft, durable: true })).toBe(false);
    expect(shouldResumeRecovery(1, false)).toBe(true);
    expect(shouldResumeRecovery(1, true)).toBe(true);
    expect(shouldResumeRecovery(0, false)).toBe(false);
  });
});
