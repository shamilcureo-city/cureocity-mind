import { describe, expect, it } from 'vitest';
import type { LiveGatewayEvent, MeterSummary } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';
import type { WindowOptions } from './vad';
import { checkLatencyBudget, LATENCY_BUDGETS } from './budgets';

/**
 * Sprint DS8 — the latency regression suite. It scripts PCM through the real
 * gateway pipeline and asserts the resulting meter is within the §0.3
 * budgets. On the mock backend the LLM latencies are ~0, so this is a SMOKE
 * run that proves the budget check + the pipeline structurally; the real p95
 * gate comes from a live-mic / Vertex run (same engine, real latencies).
 */
function pcm(ms: number, amplitude: number, sampleRate = 16_000): Buffer {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(amplitude, i * 2);
  return buf;
}

const OPTS: WindowOptions = {
  sampleRate: 16_000,
  frameMs: 20,
  threshold: 0.015,
  minWindowMs: 4_000,
  maxWindowMs: 8_000,
  silenceMs: 400,
  minSpeechFraction: 0.05,
};
const BLOCK = Buffer.concat([pcm(5_000, 8_000), pcm(500, 0)]);

function mockBackends(): LiveBackends {
  return {
    backend: 'mock',
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
    therapyReasoning: new MockGeminiTherapyReasoningBackend(),
  };
}

function baseMeter(over: Partial<MeterSummary>): MeterSummary {
  return {
    sessionId: 's',
    backend: 'mock',
    windows: 3,
    pass1Calls: 3,
    pass2Calls: 1,
    inputTokens: 100,
    outputTokens: 50,
    costInr: 0.5,
    transcriptP50Ms: 500,
    transcriptP95Ms: 900,
    speechToTranscriptP50Ms: 1_200,
    speechToTranscriptP95Ms: 1_800,
    noteP50Ms: 1_000,
    noteP95Ms: 2_000,
    elapsedMs: 20_000,
    ...over,
  };
}

describe('latency budget check (DS8)', () => {
  it('passes a within-budget meter', () => {
    expect(checkLatencyBudget(baseMeter({})).ok).toBe(true);
  });

  it('flags a transcript-latency breach', () => {
    const res = checkLatencyBudget(baseMeter({ transcriptP95Ms: 3_000 }));
    expect(res.ok).toBe(false);
    expect(res.breaches.map((b) => b.metric)).toContain('transcriptP95Ms');
  });

  it('flags a cost-ceiling breach', () => {
    const res = checkLatencyBudget(baseMeter({ costInr: 4 }));
    expect(res.ok).toBe(false);
    expect(res.breaches.map((b) => b.metric)).toContain('costInr');
    expect(LATENCY_BUDGETS.costInrCeiling).toBe(3);
  });

  it('DOC-9: flags the HONEST speech→transcript latency, not just the Pass-1 call', () => {
    // A realistic consult: the Pass-1 CALL is fast (900ms, within budget) but
    // the lived speech→transcript is ~12s once the window-wait is counted.
    // The old check read green off transcriptP95Ms; the honest metric breaches.
    const realistic = baseMeter({ transcriptP95Ms: 900, speechToTranscriptP95Ms: 12_000 });
    const res = checkLatencyBudget(realistic);
    expect(res.ok).toBe(false);
    expect(res.breaches.map((b) => b.metric)).toContain('speechToTranscriptP95Ms');
    // The Pass-1-call sub-metric alone would NOT have breached — that's the bug.
    expect(checkLatencyBudget(baseMeter({ transcriptP95Ms: 900 })).ok).toBe(true);
  });

  it('a scripted mock consult stays within budget end-to-end', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'lat',
      'Cardiology',
      mockBackends(),
      (e) => events.push(e),
      OPTS,
    );
    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();
    await session.finalize();

    const meters = events.filter((e) => e.type === 'meter');
    const last = meters[meters.length - 1]!;
    expect(last.type).toBe('meter');
    if (last.type === 'meter') {
      const check = checkLatencyBudget(last.summary);
      expect(check.ok, JSON.stringify(check.breaches)).toBe(true);
    }
  });
});
