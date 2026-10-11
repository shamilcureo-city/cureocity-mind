import { describe, expect, it } from 'vitest';
import {
  clearRecoveryDraftAfterDurableSave,
  createRecoveryContext,
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
  it('restores unique words on reopen and clears only after durable save', async () => {
    const storage = memoryStorage();
    const key = Buffer.alloc(32, 3).toString('base64');
    const context = await createRecoveryContext('psy-1', 'session-1', key);
    await loadRecoveryDraft(storage, context);
    await saveRecoveryDraft(storage, context, {
      version: 1,
      sessionId: 'session-1',
      utterances: [
        { id: 'u-1', speaker: 'client', text: 'I need this preserved.', tStartMs: 42, tEndMs: 80 },
      ],
      transcript: 'Client: I need this preserved.',
      captureMode: 'LIVE',
      durable: false,
      savedAt: new Date().toISOString(),
    });

    const reopenedContext = await createRecoveryContext('psy-1', 'session-1', key);
    const reopened = (await loadRecoveryDraft(storage, reopenedContext)).draft;
    expect(hasUniqueUnsavedContent(reopened)).toBe(true);
    await clearRecoveryDraftAfterDurableSave(storage, reopenedContext, false);
    expect((await loadRecoveryDraft(storage, reopenedContext)).draft).toEqual(reopened);
    await clearRecoveryDraftAfterDurableSave(storage, reopenedContext, true);
    expect(
      (await loadRecoveryDraft(storage, await createRecoveryContext('psy-1', 'session-1', key)))
        .draft,
    ).toBeNull();
  });
});
