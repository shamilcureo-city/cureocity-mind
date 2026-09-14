import { describe, expect, it, vi } from 'vitest';
import type { LiveGatewayEvent } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  Pass2BackendError,
  ReasoningBackendError,
  TherapyReasoningBackendError,
  type GeminiCallLogData,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';

const failedUsage = (pass: GeminiCallLogData['pass']): GeminiCallLogData => ({
  sessionId: 'cost-test',
  pass,
  model: 'synthetic-provider',
  region: 'test',
  promptVersion: 'test',
  inputTokens: 100,
  outputTokens: 200,
  costInr: 0.25,
  latencyMs: 1,
  status: 'ERROR',
  errorMessage: 'INVALID_SYNTHETIC_OUTPUT',
});

function makeSession(
  backends: LiveBackends,
  vertical: 'DOCTOR' | 'THERAPIST',
  events: LiveGatewayEvent[],
) {
  return new LiveSession(
    'cost-test',
    null,
    backends,
    (event) => events.push(event),
    {
      sampleRate: 16000,
      frameMs: 20,
      threshold: 0.015,
      minWindowMs: 4000,
      maxWindowMs: 8000,
      silenceMs: 400,
      minSpeechFraction: 0.05,
    },
    undefined,
    undefined,
    vertical,
    'TREATMENT',
    vertical === 'THERAPIST' ? 'CBT' : null,
  );
}

function testAudio(): Buffer {
  const speech = Buffer.alloc(5000 * 32);
  for (let offset = 0; offset < speech.length; offset += 2) speech.writeInt16LE(8000, offset);
  return Buffer.concat([speech, Buffer.alloc(500 * 32)]);
}

function backends(): LiveBackends {
  // Direct synthetic backends only. Never starts a production gateway or sends audio out.
  return {
    backend: 'vertex',
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
    therapyReasoning: new MockGeminiTherapyReasoningBackend(),
  };
}

function lastMeter(events: LiveGatewayEvent[]) {
  const meters = events.flatMap((event) => (event.type === 'meter' ? [event.summary] : []));
  expect(meters.length).toBeGreaterThan(0);
  return meters.at(-1)!;
}

describe('failed live provider response accounting', () => {
  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'records a rejected %s note response once and does not rebill it on finalization',
    async (vertical) => {
      const events: LiveGatewayEvent[] = [];
      const fake = backends();
      const original = fake.pass2.run.bind(fake.pass2);
      const run = vi
        .fn()
        .mockRejectedValueOnce(
          new Pass2BackendError('Synthetic invalid output', failedUsage('PASS_2_NOTE_GENERATION')),
        )
        .mockImplementation(original);
      fake.pass2 = { run };
      const session = makeSession(fake, vertical, events);
      try {
        session.pushAudio(testAudio());
        await session.pump();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        await session.finalize();
        const meter = lastMeter(events);
        expect(run).toHaveBeenCalledTimes(2); // rejected interim, successful final
        expect(meter.pass2Calls).toBe(2);
        expect(meter.costInr).toBe(0.25);
        expect(meter.costBreakdown?.notesInr).toBe(0.25);
      } finally {
        session.dispose();
      }
    },
  );

  it.each(['DOCTOR', 'THERAPIST'] as const)(
    'records a rejected %s reasoning response exactly once',
    async (vertical) => {
      const events: LiveGatewayEvent[] = [];
      const fake = backends();
      const error =
        vertical === 'DOCTOR'
          ? new ReasoningBackendError('Synthetic invalid output', failedUsage('PASS_11_REASONING'))
          : new TherapyReasoningBackendError(
              'Synthetic invalid output',
              failedUsage('PASS_12_THERAPY_REASONING'),
            );
      const run = vi.fn().mockRejectedValue(error);
      if (vertical === 'DOCTOR') fake.reasoning = { run };
      else fake.therapyReasoning = { run };
      const session = makeSession(fake, vertical, events);
      try {
        session.pushAudio(testAudio());
        await session.pump();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        await session.finalize();
        const meter = lastMeter(events);
        expect(run).toHaveBeenCalledTimes(1);
        expect(meter.reasoningCalls).toBe(1);
        expect(meter.costInr).toBe(0.25);
        expect(meter.costBreakdown?.reasoningInr).toBe(0.25);
      } finally {
        session.dispose();
      }
    },
  );
});
