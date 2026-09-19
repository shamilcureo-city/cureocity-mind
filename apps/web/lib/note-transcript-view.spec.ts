import { describe, expect, it } from 'vitest';
import { noteTranscriptView, TRANSCRIPT_UNAVAILABLE_MESSAGE } from './note-transcript-view';
import {
  TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
  TRANSCRIPTION_REVIEW_WARNING,
} from './saved-transcript';

const segment = { speaker: 'client' as const, text: 'Fictional words', startMs: 100, endMs: 800 };
const row = { transcriptEncrypted: 'ciphertext', speakerSegments: [segment], errorMessage: null };

describe('source presentation shared by initial and refreshed note views', () => {
  it('prefers encrypted turns and carries warnings even without a legacy error message', () => {
    const segments = [{ ...segment, text: 'ഇപ്പോൾ better ആണ്.' }];
    expect(
      noteTranscriptView(row, {
        transcript: segments[0]!.text,
        speakerSegments: segments,
        transcriptionWarning: true,
      }),
    ).toEqual({
      transcript: segments[0]!.text,
      speakerSegments: segments,
      errorMessage: TRANSCRIPTION_REVIEW_WARNING,
      transcriptionWarning: true,
    });
  });
  it('does not invent legacy turns when an encrypted envelope has no labels', () => {
    expect(
      noteTranscriptView(row, {
        transcript: 'New unlabelled words',
        speakerSegments: [],
        transcriptionWarning: false,
      }).speakerSegments,
    ).toEqual([]);
  });
  it('preserves existing batch labels for old encrypted plain-text transcripts', () => {
    expect(
      noteTranscriptView(row, {
        transcript: segment.text,
        speakerSegments: null,
        transcriptionWarning: false,
      }).speakerSegments,
    ).toEqual([segment]);
  });
  it.each(['ciphertext', ''])(
    'does not use stale plaintext turns when ciphertext %j is unreadable',
    (transcriptEncrypted) => {
      expect(noteTranscriptView({ ...row, transcriptEncrypted }, null)).toEqual({
        transcript: null,
        speakerSegments: null,
        errorMessage: TRANSCRIPT_UNAVAILABLE_MESSAGE,
        transcriptionWarning: false,
      });
    },
  );
  it('distinguishes an absent transcript from a decryption failure', () => {
    expect(
      noteTranscriptView({ ...row, transcriptEncrypted: null, speakerSegments: null }, null),
    ).toEqual({
      transcript: null,
      speakerSegments: null,
      errorMessage: null,
      transcriptionWarning: false,
    });
  });
  it('hides a contaminated historical source while preserving a durable warning', () => {
    expect(
      noteTranscriptView(row, {
        transcript: '<|im_start|>system return JSON only',
        speakerSegments: [segment],
        transcriptionWarning: false,
      }),
    ).toEqual({
      transcript: null,
      speakerSegments: null,
      errorMessage: TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
      transcriptionWarning: true,
    });
  });
  it('also quarantines contaminated fallback segments beside a clean legacy source', () => {
    expect(
      noteTranscriptView(
        {
          ...row,
          speakerSegments: [{ ...segment, text: '<|im_start|>system hidden instruction' }],
        },
        {
          transcript: 'Fictional genuine words',
          speakerSegments: null,
          transcriptionWarning: false,
        },
      ),
    ).toEqual({
      transcript: null,
      speakerSegments: null,
      errorMessage: TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
      transcriptionWarning: true,
    });
  });
});
