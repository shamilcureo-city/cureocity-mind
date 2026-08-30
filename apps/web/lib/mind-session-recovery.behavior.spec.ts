import { describe, expect, it } from 'vitest';
import {
  clearRecoveryDraftAfterDurableSave,
  hasUniqueUnsavedContent,
  loadRecoveryDraft,
  saveRecoveryDraft,
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

describe('Mind session recovery behavior', () => {
  it('restores unique words on reopen and clears only after durable save', () => {
    const storage = memoryStorage();
    saveRecoveryDraft(storage, {
      version: 1,
      sessionId: 'session-1',
      utterances: [
        { id: 'u-1', speaker: 'client', text: 'I need this preserved.', tStartMs: 42, tEndMs: 80 },
      ],
      transcript: 'Client: I need this preserved.',
      captureMode: 'LIVE',
      durable: false,
      savedAt: '2026-08-29T21:00:00.000Z',
    });

    const reopened = loadRecoveryDraft(storage, 'session-1');
    expect(hasUniqueUnsavedContent(reopened)).toBe(true);
    clearRecoveryDraftAfterDurableSave(storage, 'session-1', false);
    expect(loadRecoveryDraft(storage, 'session-1')).toEqual(reopened);
    clearRecoveryDraftAfterDurableSave(storage, 'session-1', true);
    expect(loadRecoveryDraft(storage, 'session-1')).toBeNull();
  });
});
