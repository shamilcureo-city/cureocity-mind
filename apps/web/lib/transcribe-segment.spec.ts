import { describe, expect, it } from 'vitest';
import { SpeakerSegmentSchema } from '@cureocity/contracts';
import {
  assembleSegments,
  coverTranscriptWithSegments,
  type AssemblyInput,
} from './transcribe-segment';

function window(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    chunkIndex: 0,
    durationMs: 30_000,
    transcript: 'sleep okay aanu',
    speakerSegments: [{ speaker: 'client', startMs: 0, endMs: 4_000, text: 'sleep okay aanu' }],
    affectFeatures: [],
    detectedLanguages: ['ml', 'en'],
    costInr: 0.4,
    latencyMs: 900,
    ...over,
  };
}

describe('coverTranscriptWithSegments', () => {
  it('leaves a real diarized timeline alone', () => {
    const segments = [{ speaker: 'client' as const, startMs: 0, endMs: 10, text: 'hi' }];
    expect(
      coverTranscriptWithSegments({ transcript: 'hi', segments, startMs: 0, endMs: 100 }),
    ).toBe(segments);
  });

  it('covers undiarized text with one unknown-speaker segment', () => {
    const out = coverTranscriptWithSegments({
      transcript: '  chest il oru tightness  ',
      segments: [],
      startMs: 0,
      endMs: 30_000,
    });
    expect(out).toEqual([
      { speaker: 'unknown', startMs: 0, endMs: 30_000, text: 'chest il oru tightness' },
    ]);
  });

  it('never attributes a covered quote to a speaker it cannot identify', () => {
    // The whole point: a therapist prompt misread as a client symptom report
    // is the failure mode that would actually matter clinically.
    const [seg] = coverTranscriptWithSegments({
      transcript: 'anything',
      segments: [],
      startMs: 0,
      endMs: 1_000,
    });
    expect(seg?.speaker).toBe('unknown');
  });

  it('emits nothing when there is genuinely no text', () => {
    for (const transcript of ['', '   ', '\n']) {
      expect(
        coverTranscriptWithSegments({ transcript, segments: [], startMs: 0, endMs: 5_000 }),
      ).toEqual([]);
    }
  });

  it('keeps endMs a positive int when the chunk duration is unknown', () => {
    // endMs is `z.number().int().positive()`; a zero-duration chunk would
    // otherwise mint a segment that fails validation downstream.
    const out = coverTranscriptWithSegments({
      transcript: 'x',
      segments: [],
      startMs: 0,
      endMs: 0,
    });
    expect(SpeakerSegmentSchema.safeParse(out[0]).success).toBe(true);
  });
});

describe('assembleSegments — transcript is never stranded outside the timeline', () => {
  it('is the regression guard for the dead AI copilot', () => {
    // Pass 1 returned text for both windows but diarized neither. This used to
    // assemble to a full transcript with ZERO speaker segments: the note came
    // out fine (Pass 2 reads `transcript`) while Pass 3 — which builds its whole
    // transcript block from speakerSegments — had nothing to read, so the
    // clinical brief 409'd with "No speaker segments available".
    const out = assembleSegments([
      window({ chunkIndex: 0, transcript: 'first window', speakerSegments: [] }),
      window({ chunkIndex: 1, transcript: 'second window', speakerSegments: [] }),
    ]);
    expect(out.transcript).toBe('first window second window');
    expect(out.speakerSegments).toHaveLength(2);
    expect(out.speakerSegments.every((s) => s.speaker === 'unknown')).toBe(true);
  });

  it('offsets a covered window to its own place on the session timeline', () => {
    const out = assembleSegments([
      window({ chunkIndex: 0, durationMs: 30_000, speakerSegments: [] }),
      window({ chunkIndex: 1, durationMs: 20_000, speakerSegments: [] }),
    ]);
    expect(out.speakerSegments[0]).toMatchObject({ startMs: 0, endMs: 30_000 });
    expect(out.speakerSegments[1]).toMatchObject({ startMs: 30_000, endMs: 50_000 });
  });

  it('mixes diarized and undiarized windows without losing either', () => {
    const out = assembleSegments([
      window({ chunkIndex: 0, durationMs: 10_000 }),
      window({ chunkIndex: 1, durationMs: 10_000, transcript: 'quiet bit', speakerSegments: [] }),
    ]);
    expect(out.speakerSegments.map((s) => s.speaker)).toEqual(['client', 'unknown']);
    expect(out.transcript).toBe('sleep okay aanu quiet bit');
  });

  it('adds nothing for a window that produced no text at all', () => {
    const out = assembleSegments([window({ transcript: '', speakerSegments: [] })]);
    expect(out.speakerSegments).toEqual([]);
    expect(out.transcript).toBe('');
  });

  it('still orders by chunkIndex and dedupes languages', () => {
    const out = assembleSegments([
      window({ chunkIndex: 1, transcript: 'second', detectedLanguages: ['en'] }),
      window({ chunkIndex: 0, transcript: 'first', detectedLanguages: ['ml', 'en'] }),
    ]);
    expect(out.transcript).toBe('first second');
    expect(out.detectedLanguages).toEqual(['ml', 'en']);
  });
});
