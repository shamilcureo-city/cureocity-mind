import { describe, expect, it } from 'vitest';
import {
  clearRecoveryDraftAfterDurableSave,
  hasUniqueUnsavedContent,
  loadRecoveryDraft,
  recoveryDraftKey,
  saveRecoveryDraft,
  shouldResumeRecovery,
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

const draft = {
  version: 1 as const,
  sessionId: 'session-1',
  savedAt: '2026-08-29T20:00:00.000Z',
  utterances: [
    { id: 'u1', speaker: 'patient' as const, text: 'I feel safer', tStartMs: 0, tEndMs: 900 },
  ],
  transcript: 'Client: I feel safer',
  captureMode: 'LIVE' as const,
  durable: false,
};

describe('live recovery draft', () => {
  it('restores unique captured content after refresh or reopen', () => {
    const storage = memoryStorage();
    saveRecoveryDraft(storage, draft);
    expect(loadRecoveryDraft(storage, 'session-1')).toEqual(draft);
    expect(hasUniqueUnsavedContent(draft)).toBe(true);
  });

  it('rejects a draft belonging to another session or a malformed value', () => {
    const storage = memoryStorage();
    saveRecoveryDraft(storage, draft);
    expect(loadRecoveryDraft(storage, 'session-2')).toBeNull();
    storage.setItem(recoveryDraftKey('session-1'), '{not-json');
    expect(loadRecoveryDraft(storage, 'session-1')).toBeNull();
  });

  it('clears recovery only after confirmed durable save', () => {
    const storage = memoryStorage();
    saveRecoveryDraft(storage, draft);
    expect(clearRecoveryDraftAfterDurableSave(storage, 'session-1', false)).toBe(false);
    expect(loadRecoveryDraft(storage, 'session-1')).toEqual(draft);
    expect(clearRecoveryDraftAfterDurableSave(storage, 'session-1', true)).toBe(true);
    expect(loadRecoveryDraft(storage, 'session-1')).toBeNull();
  });

  it('does not guard navigation for empty or already durable content', () => {
    expect(hasUniqueUnsavedContent({ ...draft, utterances: [], transcript: '' })).toBe(false);
    expect(hasUniqueUnsavedContent({ ...draft, durable: true })).toBe(false);
  });

  it('always resumes when browser-held utterances exist, including ordinary Retry', () => {
    expect(shouldResumeRecovery(1, false)).toBe(true);
    expect(shouldResumeRecovery(1, true)).toBe(true);
    expect(shouldResumeRecovery(0, false)).toBe(false);
  });
});
