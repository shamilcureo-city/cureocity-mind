import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedTranscript } from './saved-transcript';
const decrypt = vi.hoisted(() => vi.fn());
vi.mock('./tenant-crypto', () => ({ decryptForTenant: decrypt }));
import { resolveNoteTranscript, resolveNoteTranscriptData } from './note-transcript';

beforeEach(() => vi.resetAllMocks());
describe('transcript decrypt boundary', () => {
  it('keeps existing prompt consumers text-only while UI can read encrypted segments', async () => {
    const segments = [
      { speaker: 'client' as const, startMs: 100, endMs: 1200, text: 'Synthetic words' },
    ];
    decrypt.mockResolvedValue(encodeSavedTranscript('Synthetic words', segments, true));
    const row = { transcriptEncrypted: 'ciphertext-only' };
    expect(await resolveNoteTranscript('psy-1', row)).toBe('Synthetic words');
    expect(await resolveNoteTranscriptData('psy-1', row)).toMatchObject({
      speakerSegments: segments,
      transcriptionWarning: true,
    });
    expect(decrypt).toHaveBeenCalledWith('psy-1', 'ciphertext-only');
  });
  it('preserves old encrypted plain text and handles missing or undecryptable values', async () => {
    decrypt.mockResolvedValue('Legacy speech');
    expect(await resolveNoteTranscript('psy-1', { transcriptEncrypted: 'old' })).toBe(
      'Legacy speech',
    );
    expect(await resolveNoteTranscript('psy-1', { transcriptEncrypted: null })).toBeNull();
    decrypt.mockResolvedValue(null);
    expect(await resolveNoteTranscript('psy-1', { transcriptEncrypted: 'broken' })).toBeNull();
  });
});
