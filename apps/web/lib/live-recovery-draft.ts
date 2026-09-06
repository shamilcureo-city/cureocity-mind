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
}

export function recoveryDraftKey(sessionId: string): string {
  return `cureocity:mind-live-recovery:${sessionId}`;
}

export function saveRecoveryDraft(storage: RecoveryStorage, draft: LiveRecoveryDraft): boolean {
  try {
    storage.setItem(recoveryDraftKey(draft.sessionId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function loadRecoveryDraft(
  storage: RecoveryStorage,
  sessionId: string,
): LiveRecoveryDraft | null {
  try {
    const raw = storage.getItem(recoveryDraftKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LiveRecoveryDraft>;
    if (
      value.version !== 1 ||
      value.sessionId !== sessionId ||
      typeof value.savedAt !== 'string' ||
      !Array.isArray(value.utterances) ||
      typeof value.transcript !== 'string' ||
      (value.captureMode !== 'LIVE' && value.captureMode !== 'BATCH') ||
      typeof value.durable !== 'boolean'
    ) {
      return null;
    }
    return value as LiveRecoveryDraft;
  } catch {
    return null;
  }
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

/** The caller must pass the actual durable-save acknowledgement, never intent. */
export function clearRecoveryDraftAfterDurableSave(
  storage: RecoveryStorage,
  sessionId: string,
  durableSaveConfirmed: boolean,
): boolean {
  if (!durableSaveConfirmed) return false;
  try {
    storage.removeItem(recoveryDraftKey(sessionId));
    return true;
  } catch {
    return false;
  }
}
