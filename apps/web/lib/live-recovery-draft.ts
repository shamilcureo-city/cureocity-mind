import type { ScribeCaptureIncompleteReason } from './scribe-capture-integrity';

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Access itself can throw when browser storage is disabled. */
export function browserRecoveryStorage(): RecoveryStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}

export interface RecoveryUtterance {
  id: string;
  speaker: string;
  text: string;
  tStartMs: number;
  tEndMs: number;
}

export interface LiveRecoveryDraft {
  version: 1;
  sessionId: string;
  savedAt: string;
  utterances: RecoveryUtterance[];
  transcript: string;
  captureMode: 'LIVE' | 'BATCH';
  durable: boolean;
  transcriptionWarning?: boolean;
  captureIncomplete?: boolean;
  captureIncompleteReason?: ScribeCaptureIncompleteReason;
}

/** Only used to migrate old plaintext; new writes never use this key. */
export function recoveryDraftKey(sessionId: string): string {
  return `cureocity:mind-live-recovery:${sessionId}`;
}

export function encryptedRecoveryDraftKey(accountId: string, sessionId: string): string {
  return `cureocity:mind-live-recovery:v2:${encodeURIComponent(accountId)}:${encodeURIComponent(sessionId)}`;
}

export const RECOVERY_AUTO_RESTORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_KEY_TIMEOUT_MS = 8_000;

/** Component-owned, never global or persisted. A non-extractable browser key. */
export interface RecoveryContext {
  readonly accountId: string;
  readonly sessionId: string;
  readonly key: CryptoKey;
  pending: Promise<unknown>;
  writable: boolean;
  closed: boolean;
  observedCiphertext: string | null | undefined;
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Called only with the response from the authenticated, session-owned key route. */
export async function createRecoveryContext(
  accountId: string,
  sessionId: string,
  base64Key: string,
): Promise<RecoveryContext> {
  if (!accountId || !sessionId) throw new Error('Invalid recovery identity');
  const bytes = decode(base64Key);
  if (bytes.length !== 32) throw new Error('Invalid recovery key');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  bytes.fill(0);
  return {
    accountId,
    sessionId,
    key,
    pending: Promise.resolve(),
    writable: false,
    closed: false,
    observedCiphertext: undefined,
  };
}

export async function fetchRecoveryContext(
  sessionId: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<RecoveryContext> {
  const controller = new AbortController();
  let rejectCancelled!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const abort = () => {
    controller.abort();
    rejectCancelled(new Error('Recovery cancelled or timed out'));
  };
  const timer = setTimeout(abort, RECOVERY_KEY_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        if (controller.signal.aborted) throw new Error('Recovery cancelled');
        const response = await request(
          `/api/v1/auth/recovery-key?sessionId=${encodeURIComponent(sessionId)}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('Secure browser recovery is unavailable');
        const body: unknown = await response.json();
        if (controller.signal.aborted || !body || typeof body !== 'object')
          throw new Error('Recovery cancelled');
        const value = body as Record<string, unknown>;
        if (
          typeof value['accountId'] !== 'string' ||
          value['sessionId'] !== sessionId ||
          typeof value['key'] !== 'string'
        )
          throw new Error('Invalid recovery response');
        const context = await createRecoveryContext(value['accountId'], sessionId, value['key']);
        if (controller.signal.aborted) throw new Error('Recovery cancelled');
        return context;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function sequential<T>(context: RecoveryContext, work: () => Promise<T>): Promise<T> {
  const locked = async (): Promise<T> => {
    // Same-origin tabs must not overwrite or clear one another's newer copy.
    // Older browsers without Web Locks still get the exact-ciphertext checks.
    if (typeof navigator !== 'undefined' && navigator.locks)
      return await navigator.locks.request(
        encryptedRecoveryDraftKey(context.accountId, context.sessionId),
        work,
      );
    return work();
  };
  const next = context.pending.then(locked, locked);
  context.pending = next.catch(() => {});
  return next;
}

function associatedData(context: RecoveryContext): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify(['mind-recovery', 2, context.accountId, context.sessionId]),
  );
}

function parseDraft(raw: string, sessionId: string): LiveRecoveryDraft {
  const value = JSON.parse(raw) as Partial<LiveRecoveryDraft>;
  const reasons = ['connection_lost', 'finalization_failed', 'audio_loss', 'capture_interrupted'];
  if (
    value.version !== 1 ||
    value.sessionId !== sessionId ||
    typeof value.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !Array.isArray(value.utterances) ||
    value.utterances.some(
      (utterance) =>
        !utterance ||
        typeof utterance.id !== 'string' ||
        typeof utterance.text !== 'string' ||
        typeof utterance.speaker !== 'string' ||
        !Number.isFinite(utterance.tStartMs) ||
        !Number.isFinite(utterance.tEndMs),
    ) ||
    typeof value.transcript !== 'string' ||
    (value.captureMode !== 'LIVE' && value.captureMode !== 'BATCH') ||
    typeof value.durable !== 'boolean' ||
    (value.transcriptionWarning !== undefined && typeof value.transcriptionWarning !== 'boolean') ||
    (value.captureIncomplete !== undefined && typeof value.captureIncomplete !== 'boolean') ||
    (value.captureIncompleteReason !== undefined &&
      !reasons.includes(value.captureIncompleteReason))
  )
    throw new Error('Invalid recovery draft');
  return value as LiveRecoveryDraft;
}

async function encryptDraft(context: RecoveryContext, draft: LiveRecoveryDraft): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(context) },
    context.key,
    new TextEncoder().encode(JSON.stringify(draft)),
  );
  return JSON.stringify({
    version: 2,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
}

async function decryptDraft(context: RecoveryContext, raw: string): Promise<LiveRecoveryDraft> {
  const envelope = JSON.parse(raw) as { version?: number; iv?: string; ciphertext?: string };
  if (
    envelope.version !== 2 ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  )
    throw new Error('Invalid recovery envelope');
  const iv = decode(envelope.iv);
  if (iv.length !== 12) throw new Error('Invalid recovery nonce');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(context) },
    context.key,
    decode(envelope.ciphertext),
  );
  return parseDraft(new TextDecoder().decode(plaintext), context.sessionId);
}

export type RecoveryLoadResult =
  | { status: 'ready'; draft: LiveRecoveryDraft | null }
  | { status: 'expired' | 'unavailable'; draft: null };

/** Expired copies need explicit recovery; never delete the only unsaved copy. */
export function loadRecoveryDraft(
  storage: RecoveryStorage,
  context: RecoveryContext,
  options: { allowExpired?: boolean; now?: number } = {},
): Promise<RecoveryLoadResult> {
  return sequential<RecoveryLoadResult>(context, async () => {
    context.writable = false;
    try {
      if (context.closed) return { status: 'unavailable', draft: null };
      const storageKey = encryptedRecoveryDraftKey(context.accountId, context.sessionId);
      const encrypted = storage.getItem(storageKey);
      context.observedCiphertext = encrypted;
      const legacy = storage.getItem(recoveryDraftKey(context.sessionId));
      let draft: LiveRecoveryDraft | null = null;
      if (encrypted) {
        draft = await decryptDraft(context, encrypted);
        if (context.closed || storage.getItem(storageKey) !== encrypted)
          throw new Error('Recovery changed');
        if (legacy) {
          // A previous migration may have encrypted successfully but failed
          // to remove plaintext. Retry only for exactly the same contents.
          if (JSON.stringify(parseDraft(legacy, context.sessionId)) !== JSON.stringify(draft))
            throw new Error('Recovery copies need review');
          if (storage.getItem(recoveryDraftKey(context.sessionId)) === legacy)
            storage.removeItem(recoveryDraftKey(context.sessionId));
        }
      } else if (legacy) {
        draft = parseDraft(legacy, context.sessionId);
        const ciphertext = await encryptDraft(context, draft);
        if (
          context.closed ||
          storage.getItem(storageKey) !== encrypted ||
          storage.getItem(recoveryDraftKey(context.sessionId)) !== legacy
        )
          throw new Error('Recovery changed');
        storage.setItem(storageKey, ciphertext);
        if (storage.getItem(storageKey) !== ciphertext) throw new Error('Recovery write failed');
        context.observedCiphertext = ciphertext;
        // Only remove the exact copy just migrated, after verified encryption.
        if (storage.getItem(recoveryDraftKey(context.sessionId)) === legacy)
          storage.removeItem(recoveryDraftKey(context.sessionId));
      }
      if (context.closed) return { status: 'unavailable', draft: null };
      if (
        draft &&
        !options.allowExpired &&
        (options.now ?? Date.now()) - Date.parse(draft.savedAt) > RECOVERY_AUTO_RESTORE_TTL_MS
      )
        return { status: 'expired', draft: null };
      context.writable = true;
      return { status: 'ready', draft };
    } catch {
      // An unreadable older copy must not be overwritten by new captured words.
      return { status: 'unavailable', draft: null };
    }
  }).catch(() => ({ status: 'unavailable', draft: null }));
}

export function saveRecoveryDraft(
  storage: RecoveryStorage,
  context: RecoveryContext,
  draft: LiveRecoveryDraft,
): Promise<boolean> {
  const snapshot = JSON.stringify(draft);
  return sequential(context, async () => {
    if (context.closed || !context.writable) return false;
    try {
      const parsed = parseDraft(snapshot, context.sessionId);
      const encrypted = await encryptDraft(context, parsed);
      const storageKey = encryptedRecoveryDraftKey(context.accountId, context.sessionId);
      if (context.closed || storage.getItem(storageKey) !== context.observedCiphertext)
        return false;
      storage.setItem(storageKey, encrypted);
      if (storage.getItem(storageKey) !== encrypted) return false;
      context.observedCiphertext = encrypted;
      return true;
    } catch {
      return false;
    }
  }).catch(() => false);
}

export function shouldResumeRecovery(
  existingUtteranceCount: number,
  explicitlyRequested: boolean,
): boolean {
  return explicitlyRequested || existingUtteranceCount > 0;
}

export function hasUniqueUnsavedContent(draft: LiveRecoveryDraft | null): boolean {
  if (!draft || draft.durable) return false;
  return (
    draft.transcript.trim().length > 0 || draft.utterances.some((u) => u.text.trim().length > 0)
  );
}

/** Wait for all older writes, then remove only the acknowledged copy. */
export function clearRecoveryDraftAfterDurableSave(
  storage: RecoveryStorage,
  context: RecoveryContext,
  durableSaveConfirmed: boolean,
): Promise<boolean> {
  if (!durableSaveConfirmed) return Promise.resolve(false);
  return sequential(context, async () => {
    context.closed = true;
    try {
      // A new server save cannot acknowledge an unreadable or expired old copy.
      if (!context.writable) return false;
      const storageKey = encryptedRecoveryDraftKey(context.accountId, context.sessionId);
      if (storage.getItem(storageKey) !== context.observedCiphertext) return false;
      storage.removeItem(storageKey);
      return true;
    } catch {
      return false;
    }
  }).catch(() => false);
}
