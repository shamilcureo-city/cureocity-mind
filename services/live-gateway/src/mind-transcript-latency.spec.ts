import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveGatewayEvent, PractitionerCapability } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass2Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';
import { DEFAULT_WINDOW_OPTIONS } from './vad';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Flush promise continuations only. Model delays below are manually controlled;
// fake timers avoid wall-clock waits and make no external/clinical requests.
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function speech(ms = 6_000) {
  const buffer = Buffer.alloc(ms * 32);
  for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(8_000, i);
  return buffer;
}

function backends(): LiveBackends {
  const pass1 = new MockGeminiPass1Backend();
  let count = 0;
  return {
    backend: 'mock',
    pass1: {
      run: vi.fn(async (input) => {
        const result = await pass1.run(input);
        const text = `chunk ${++count}`;
        return {
          ...result,
          output: {
            ...result.output,
            transcript: text,
            speakerSegments: [
              { speaker: 'client' as const, text, startMs: 0, endMs: input.durationMs },
            ],
          },
        };
      }),
    },
    pass2: { run: vi.fn((input) => new MockGeminiPass2Backend().run(input)) },
    pass2Final: { run: vi.fn((input) => new MockGeminiPass2Backend().run(input)) },
    reasoning: new MockGeminiReasoningBackend(),
    therapyReasoning: { run: vi.fn((input) => new MockGeminiTherapyReasoningBackend().run(input)) },
  };
}

const sessions: LiveSession[] = [];
function setup(b = backends(), vertical: 'THERAPIST' | 'DOCTOR' = 'THERAPIST') {
  const events: LiveGatewayEvent[] = [];
  const session = new LiveSession(
    'latency-test',
    null,
    b,
    (e) => events.push(e),
    DEFAULT_WINDOW_OPTIONS,
    undefined,
    undefined,
    vertical,
  );
  sessions.push(session);
  session.start();
  return { session, events, b };
}

async function window(session: LiveSession) {
  session.pushAudio(speech());
  await session.pump();
  await settle();
}

function transcripts(events: LiveGatewayEvent[]) {
  return events.flatMap((e) => (e.type === 'utterance' ? [e.utterance.text] : []));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Mind transcription stays independent of ordered background analysis', () => {
  it('emits later windows once and in order while reasoning is slow; coalesces the pending batch', async () => {
    vi.stubEnv('LIVE_REASONING_MIN_GAP_MS', '0');
    const b = backends();
    const gate = deferred();
    const inner = b.therapyReasoning.run;
    let calls = 0;
    b.therapyReasoning.run = vi.fn(async (input) => {
      if (++calls === 1) await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    await window(session);
    await window(session);
    expect(transcripts(events)).toEqual(['chunk 1', 'chunk 2', 'chunk 3']);
    expect(b.therapyReasoning.run).toHaveBeenCalledTimes(1);
    expect(b.pass2.run).not.toHaveBeenCalled();
    gate.resolve();
    await settle();
    expect(b.therapyReasoning.run).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(b.therapyReasoning.run).mock.calls[1]![0].newUtterances.map((u) => u.text),
    ).toEqual(['chunk 2', 'chunk 3']);
    expect(b.pass2.run).toHaveBeenCalledTimes(1); // note debounce still applies
  });

  it('keeps note inputs immutable and manual refresh serialized without blocking audio', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.pass2.run;
    let first: Pass2Input | undefined;
    let active = 0;
    let maxActive = 0;
    b.pass2.run = vi.fn(async (input) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (!first) {
        first = input;
        await gate.promise;
      }
      const result = await inner(input);
      active--;
      return result;
    });
    const { session, events } = setup(b);
    await window(session);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    session.requestNoteRefresh();
    session.requestNoteRefresh(); // throttled, not another queued paid call
    await window(session);
    expect(transcripts(events)).toEqual(['chunk 1', 'chunk 2']);
    expect(first!.transcript).toBe('chunk 1');
    expect(first!.speakerSegments).toHaveLength(1);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    gate.resolve();
    await settle();
    expect(maxActive).toBe(1);
    expect(b.pass2.run).toHaveBeenCalledTimes(2);
    expect(vi.mocked(b.pass2.run).mock.calls[1]![0].transcript).toBe('chunk 1 chunk 2');
  });

  it('runs the coalesced reasoning batch when due even if speech stops', async () => {
    const { session, b } = setup();
    await window(session);
    await window(session);
    expect(b.therapyReasoning.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(b.therapyReasoning.run).toHaveBeenCalledTimes(2);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
  });

  it('joins owned analysis and transcribes the tail before exactly one final note', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    await window(session);
    session.pushAudio(speech(1_000));
    const finishing = session.finalize();
    await settle();
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
    gate.resolve();
    await finishing;
    const finals = events.filter((e) => e.type === 'therapyFinal');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ transcript: 'chunk 1 chunk 2 chunk 3' });
    expect(vi.mocked(b.pass2Final!.run).mock.calls[0]![0].transcript).toBe(
      'chunk 1 chunk 2 chunk 3',
    );
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    const count = events.length;
    session.requestNoteRefresh();
    await session.pump();
    await settle();
    expect(events).toHaveLength(count);
  });

  it('invalidates a late interim after finalize times out, including when no note exists', async () => {
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    const b = backends();
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    const finishing = session.finalize();
    await vi.advanceTimersByTimeAsync(5_001);
    await finishing;
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    expect(events.some((e) => e.type === 'therapyFinal')).toBe(false);
    const count = events.length;
    gate.resolve();
    await settle();
    expect(events).toHaveLength(count);
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
  });

  it('keeps a timeout fallback final unchanged when a held refresh completes late', async () => {
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    const { session, events, b } = setup();
    await window(session);
    const latest = events.find((e) => e.type === 'therapyNote');
    expect(latest?.type).toBe('therapyNote');
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    session.requestNoteRefresh();
    await settle();
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    const finishing = session.finalize();
    await vi.advanceTimersByTimeAsync(5_001);
    await finishing;
    const finals = events.filter((e) => e.type === 'therapyFinal');
    expect(finals).toHaveLength(1);
    if (latest?.type === 'therapyNote') expect(finals[0]!.note).toEqual(latest.note);
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    const count = events.length;
    gate.resolve();
    await settle();
    expect(events).toHaveLength(count);
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
  });

  it('does not apply a reasoning result across an optional-authority revoke and regrant', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.therapyReasoning.run;
    b.therapyReasoning.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    const caps = new Set<PractitionerCapability>([
      'LIVE_ENCOUNTER',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
    session.updateCapabilities(caps);
    session.updateCapabilities(new Set([...caps, 'CLINICAL_ANALYSIS']));
    const count = events.filter((e) => e.type === 'therapyReasoning').length;
    gate.resolve();
    await settle();
    expect(events.filter((e) => e.type === 'therapyReasoning')).toHaveLength(count);
    expect(b.pass2.run).toHaveBeenCalledTimes(1); // documentation can continue
  });

  it('disposal invalidates in-flight analysis and starts no further note calls', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.therapyReasoning.run;
    b.therapyReasoning.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    session.dispose();
    const count = events.length;
    gate.resolve();
    await settle();
    expect(events).toHaveLength(count);
    expect(b.pass2.run).not.toHaveBeenCalled();
  });

  it('disposal prevents a late transcription from emitting or starting analysis', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.pass1.run;
    b.pass1.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    session.pushAudio(speech());
    const pumping = session.pump();
    await settle();
    session.dispose();
    const count = events.length;
    gate.resolve();
    await pumping;
    await settle();
    expect(events).toHaveLength(count);
    expect(b.therapyReasoning.run).not.toHaveBeenCalled();
    expect(b.pass2.run).not.toHaveBeenCalled();
  });

  it('meters background analysis cost and enforces the ceiling without more speech', async () => {
    vi.stubEnv('LIVE_COST_CEILING_INR', '1');
    const b = backends();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      const result = await inner(input);
      return { ...result, callLog: { ...result.callLog, costInr: 2 } };
    });
    const { session, events } = setup(b);
    await window(session);
    await settle();
    expect(events.some((e) => e.type === 'meter' && e.summary.costInr >= 2)).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.state === 'done')).toBe(true);
  });

  it('preserves the existing doctor scheduling path', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b, 'DOCTOR');
    session.pushAudio(speech());
    const pumping = session.pump();
    await settle();
    session.pushAudio(speech());
    await session.pump();
    expect(transcripts(events)).toEqual(['chunk 1']);
    gate.resolve();
    await pumping;
    expect(transcripts(events)).toEqual(['chunk 1', 'chunk 2']);
  });
});
