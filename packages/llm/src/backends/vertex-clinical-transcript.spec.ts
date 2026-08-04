import { describe, expect, it } from 'vitest';
import type { Pass3Input } from '../types';
import { renderTranscriptBlock } from './vertex-clinical.backend';

function input(over: Partial<Pass3Input> = {}): Pass3Input {
  return {
    sessionId: 's1',
    transcript: 'chest il oru tightness, two weeks aayi',
    speakerSegments: [
      {
        speaker: 'client',
        startMs: 1_000,
        endMs: 4_000,
        text: 'chest il oru tightness, two weeks aayi',
      },
    ],
    kind: 'TREATMENT',
    modality: 'CBT',
    language: 'en',
    note: {},
    clientContext: {},
    ...over,
  } as Pass3Input;
}

describe('renderTranscriptBlock', () => {
  it('renders the diarized timeline when there is one', () => {
    expect(renderTranscriptBlock(input())).toBe(
      '[client 1000-4000ms] chest il oru tightness, two weeks aayi',
    );
  });

  it('falls back to the plain transcript rather than an empty section', () => {
    // The bug this guards: with no speaker segments the block rendered as ''
    // under a heading promising a transcript, so Pass 3 was asked to produce a
    // clinical brief — with verbatim supporting quotes — from nothing at all.
    const out = renderTranscriptBlock(input({ speakerSegments: [] }));
    expect(out).toContain('chest il oru tightness, two weeks aayi');
    expect(out.trim()).not.toBe('');
  });

  it('tells the model diarization is missing and forbids guessing the speaker', () => {
    const out = renderTranscriptBlock(input({ speakerSegments: [] }));
    expect(out).toMatch(/diarization is unavailable/i);
    expect(out).toMatch(/do NOT guess/i);
    expect(out).toContain('[unknown ');
  });

  it('says so plainly when there is genuinely nothing to read', () => {
    expect(renderTranscriptBlock(input({ speakerSegments: [], transcript: '   ' }))).toBe(
      '(no transcript available)',
    );
  });
});
