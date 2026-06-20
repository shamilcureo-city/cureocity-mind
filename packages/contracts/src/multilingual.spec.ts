import { describe, expect, it } from 'vitest';
import { SegmentLanguageSchema, SpeakerSegmentSchema } from './note';

describe('SegmentLanguageSchema', () => {
  it.each(['en', 'ml', 'hi', 'ta', 'bn', 'kn', 'te', 'mr', 'gu', 'pa', 'ur', 'mixed', 'unknown'])(
    'accepts %s',
    (code) => {
      expect(SegmentLanguageSchema.safeParse(code).success).toBe(true);
    },
  );

  it.each(['English', 'ml_in', 'MIXED', '!!', ''])('rejects %s', (code) => {
    expect(SegmentLanguageSchema.safeParse(code).success).toBe(false);
  });
});

describe('SpeakerSegmentSchema (Sprint 16 — language tag)', () => {
  const base = {
    speaker: 'client' as const,
    startMs: 0,
    endMs: 5000,
    text: 'അനുകൂലമായ ഒരു ദിവസമായിരുന്നു',
  };

  it('accepts a segment WITHOUT a language tag (legacy compat)', () => {
    expect(SpeakerSegmentSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a segment with language=ml', () => {
    expect(SpeakerSegmentSchema.safeParse({ ...base, language: 'ml' }).success).toBe(true);
  });

  it('accepts language=mixed for a Manglish utterance', () => {
    expect(
      SpeakerSegmentSchema.safeParse({
        ...base,
        text: 'എനിക്ക് anxiety undu',
        language: 'mixed',
      }).success,
    ).toBe(true);
  });

  it('accepts language=unknown when detection was not confident', () => {
    expect(SpeakerSegmentSchema.safeParse({ ...base, language: 'unknown' }).success).toBe(true);
  });

  it('rejects a malformed language tag', () => {
    expect(SpeakerSegmentSchema.safeParse({ ...base, language: 'Malayalam' }).success).toBe(false);
  });
});
