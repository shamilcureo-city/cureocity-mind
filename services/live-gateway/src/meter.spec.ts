import { describe, expect, it } from 'vitest';
import type { GeminiCallLogData } from '@cureocity/llm';
import { ConsultMeter, percentile } from './meter';

function pass1Log(over: Partial<GeminiCallLogData> = {}): GeminiCallLogData {
  return {
    sessionId: 's',
    pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
    model: 'mock-flash',
    region: 'mock',
    promptVersion: 'v1',
    inputTokens: 100,
    outputTokens: 200,
    costInr: 0.5,
    latencyMs: 0,
    status: 'SUCCESS',
    ...over,
  };
}

function pass2Log(over: Partial<GeminiCallLogData> = {}): GeminiCallLogData {
  return { ...pass1Log(), pass: 'PASS_2_NOTE_GENERATION', model: 'mock-pro', ...over };
}

describe('percentile (nearest-rank)', () => {
  it('is 0 for an empty set', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });
  it('returns the single sample for every percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });
  it('picks the nearest rank', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2); // ceil(0.5*4)=2 → index 1
    expect(percentile([1, 2, 3, 4], 95)).toBe(4); // ceil(0.95*4)=4 → index 3
  });
  it('is order-independent', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
  });
});

describe('ConsultMeter', () => {
  it('accumulates tokens/cost, counts windows, and computes latency percentiles', () => {
    const m = new ConsultMeter();
    m.recordTranscribe(pass1Log({ inputTokens: 100, costInr: 0.5 }), 10);
    m.markWindow();
    m.recordTranscribe(pass1Log({ inputTokens: 100, costInr: 0.5 }), 30);
    m.markWindow();
    // Fractional Pass-2 input tokens (the mock divides transcript length by 4).
    m.recordNote(pass2Log({ inputTokens: 62.5, outputTokens: 400, costInr: 1.0 }), 50);

    const s = m.summary('sess-1', 'mock', 1_000);
    expect(s.sessionId).toBe('sess-1');
    expect(s.backend).toBe('mock');
    expect(s.windows).toBe(2);
    expect(s.pass1Calls).toBe(2);
    expect(s.pass2Calls).toBe(1);
    // 100 + 100 + 62.5 → rounded to an integer for the contract + DB column.
    expect(s.inputTokens).toBe(263);
    expect(Number.isInteger(s.inputTokens)).toBe(true);
    expect(s.outputTokens).toBe(800);
    expect(s.costInr).toBeCloseTo(2.0, 4);
    expect(s.transcriptP50Ms).toBe(10);
    expect(s.transcriptP95Ms).toBe(30);
    expect(s.noteP50Ms).toBe(50);
    expect(s.noteP95Ms).toBe(50);
    expect(s.elapsedMs).toBe(1_000);
  });

  it('exposes per-window Pass-1 tokens in order', () => {
    const m = new ConsultMeter();
    m.recordTranscribe(pass1Log({ inputTokens: 160 }), 5);
    m.recordTranscribe(pass1Log({ inputTokens: 160 }), 5);
    m.recordTranscribe(pass1Log({ inputTokens: 160 }), 5);
    expect([...m.transcribeInputTokens]).toEqual([160, 160, 160]);
  });

  it('breaks down recorded AI estimates by work instead of implying a transcription-only rate', () => {
    const m = new ConsultMeter();
    m.recordTranscribe(pass1Log({ costInr: 0.21 }), 100);
    m.recordNote(pass2Log({ costInr: 0.85 }), 1000);
    m.recordReasoning(pass1Log({ pass: 'PASS_12_THERAPY_REASONING', costInr: 0.15 }));
    // Paid provider responses still count when their output was rejected.
    m.recordTranscribe(pass1Log({ status: 'ERROR', costInr: 0.03 }), 100);
    const result = m.summary('s', 'vertex', 60000);
    expect(result.costInr).toBe(1.24);
    expect(result.reasoningCalls).toBe(1);
    expect(result.costBreakdown).toEqual({
      transcriptionInr: 0.24,
      notesInr: 0.85,
      reasoningInr: 0.15,
    });
  });

  it('keeps connection scopes separate and mock estimates at zero', () => {
    const first = new ConsultMeter();
    first.recordNote(pass2Log(), 10);
    const reconnected = new ConsultMeter().summary('s', 'vertex', 0);
    expect(reconnected.costInr).toBe(0);
    expect(reconnected.reasoningCalls).toBe(0);
    const mock = new ConsultMeter();
    mock.recordTranscribe(pass1Log({ costInr: 0 }), 5);
    expect(mock.summary('s', 'mock', 100).costBreakdown).toEqual({
      transcriptionInr: 0,
      notesInr: 0,
      reasoningInr: 0,
    });
  });

  it('reports all-zero latencies before any call', () => {
    const s = new ConsultMeter().summary('s', 'mock', 0);
    expect(s.windows).toBe(0);
    expect(s.transcriptP95Ms).toBe(0);
    expect(s.costInr).toBe(0);
  });
});
