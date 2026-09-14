import { describe, it, expect } from 'vitest';
import { Pass1OutputSchema, TherapyNoteV1Schema } from './index';

describe('Pass1OutputSchema', () => {
  it('accepts a well-formed pass 1 output', () => {
    const ok = Pass1OutputSchema.parse({
      transcript: 'Hello',
      speakerSegments: [{ speaker: 'therapist', startMs: 0, endMs: 1000, text: 'hi' }],
      affectFeatures: [{ startMs: 0, endMs: 1000, valence: 0, arousal: 0.5 }],
    });
    expect(ok.speakerSegments).toHaveLength(1);
  });

  it('rejects valence out of [-1, 1]', () => {
    expect(() =>
      Pass1OutputSchema.parse({
        transcript: 'x',
        speakerSegments: [],
        affectFeatures: [{ startMs: 0, endMs: 1, valence: 2, arousal: 0.5 }],
      }),
    ).toThrow();
  });

  it('rejects arousal out of [0, 1]', () => {
    expect(() =>
      Pass1OutputSchema.parse({
        transcript: 'x',
        speakerSegments: [],
        affectFeatures: [{ startMs: 0, endMs: 1, valence: 0, arousal: 1.5 }],
      }),
    ).toThrow();
  });

  const artifact =
    'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';
  it.each([
    { transcript: artifact, speakerSegments: [], affectFeatures: [] },
    {
      transcript: 'Hello',
      speakerSegments: [{ speaker: 'unknown', startMs: 0, endMs: 1000, text: artifact }],
      affectFeatures: [],
    },
    {
      transcript: 'Hello',
      speakerSegments: [],
      affectFeatures: [{ startMs: 0, endMs: 1000, valence: 0, arousal: 0, notes: artifact }],
    },
  ])('rejects artifacts in every text-bearing output field', (value) => {
    const result = Pass1OutputSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === 'TRANSCRIPTION_ARTIFACT')).toBe(
        true,
      );
      expect(result.error.message).not.toContain(artifact);
    }
  });

  it.each([
    '',
    '[inaudible]',
    'Sharafath said the word placeholder.',
    'എനിക്ക് ഉത്കണ്ഠ തോന്നുന്നു.',
    'എനിക്ക് anxiety undu. I used a placeholder in my notes.',
  ])('preserves legitimate words without rewriting them: %s', (transcript) => {
    const value = { transcript, speakerSegments: [], affectFeatures: [] };
    expect(Pass1OutputSchema.parse(value).transcript).toBe(transcript);
  });
});

describe('TherapyNoteV1Schema', () => {
  const valid = {
    version: 'V1' as const,
    modality: 'CBT' as const,
    subjective: 'X',
    objective: 'X',
    assessment: 'X',
    plan: 'X',
    riskFlags: { severity: 'none' as const, indicators: [] },
  };

  it('accepts a minimal valid note', () => {
    expect(TherapyNoteV1Schema.parse(valid).version).toBe('V1');
  });

  it('rejects when SOAP fields are empty', () => {
    expect(() => TherapyNoteV1Schema.parse({ ...valid, subjective: '' })).toThrow();
  });

  it('rejects severity not in the enum', () => {
    expect(() =>
      TherapyNoteV1Schema.parse({
        ...valid,
        riskFlags: { severity: 'EXTREME', indicators: [] },
      }),
    ).toThrow();
  });

  it('defaults phaseHints to []', () => {
    const parsed = TherapyNoteV1Schema.parse(valid);
    expect(parsed.phaseHints).toEqual([]);
  });
});
