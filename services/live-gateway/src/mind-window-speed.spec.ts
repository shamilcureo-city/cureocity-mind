import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveGatewayEvent } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass1Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import { windowOptionsFromEnv } from './vad';

const sessions: LiveSession[] = [];
const requestId = '00000000-0000-4000-8000-000000000001';

function pcm(ms: number, silent = false): Buffer {
  const bytes = Buffer.alloc(ms * 32);
  if (!silent)
    for (let offset = 0; offset < bytes.length; offset += 2)
      bytes.writeInt16LE(6_000 + ((offset / 2) % 2_000), offset);
  return bytes;
}

function setup(vertical: 'THERAPIST' | 'DOCTOR', beforeFirst?: () => Promise<void>) {
  const events: LiveGatewayEvent[] = [];
  const startedAt = Date.now();
  const callTimes: number[] = [];
  const accepted: Buffer[] = [];
  let active = 0;
  let maxActive = 0;
  const mock = new MockGeminiPass1Backend();
  const run = vi.fn(async (input: Pass1Input) => {
    callTimes.push(Date.now() - startedAt);
    accepted.push(Buffer.from(input.audioBytes));
    const number = callTimes.length;
    maxActive = Math.max(maxActive, ++active);
    try {
      if (number === 1) await beforeFirst?.();
      const result = await mock.run(input);
      const text = `Fictional window ${number}`;
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
    } finally {
      active--;
    }
  });
  const session = new LiveSession(
    'fictional-window-speed',
    null,
    {
      backend: 'mock',
      pass1: { run },
      pass2: new MockGeminiPass2Backend(),
      reasoning: new MockGeminiReasoningBackend(),
      therapyReasoning: new MockGeminiTherapyReasoningBackend(),
    },
    (event) => events.push(event),
    windowOptionsFromEnv({}, vertical),
    undefined,
    undefined,
    vertical,
  );
  sessions.push(session);
  session.start();
  return { session, events, run, callTimes, accepted, maxActive: () => maxActive };
}

// Deliver one 100ms piece per 100ms of fake time through the real timer-driven
// pump. No direct pump() shortcut and no microphone/network/model calls.
async function deliver(session: LiveSession, bytes: Buffer) {
  for (let offset = 0; offset < bytes.length; offset += 3_200) {
    const frame = bytes.subarray(offset, offset + 3_200);
    session.pushAudio(frame);
    await vi.advanceTimersByTimeAsync(frame.length / 32);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.useRealTimers();
});

describe('Mind-only timer-driven transcription speed profile', () => {
  it.each([
    ['THERAPIST', 4_000],
    ['DOCTOR', 6_000],
  ] as const)('first continuous-speech window for %s starts at %ims', async (vertical, firstAt) => {
    const fixture = setup(vertical);
    await deliver(fixture.session, pcm(firstAt - 100));
    expect(fixture.run).not.toHaveBeenCalled();
    await deliver(fixture.session, pcm(100));
    expect(fixture.callTimes).toEqual([firstAt]);
    expect(fixture.run.mock.calls[0][0].durationMs).toBe(firstAt);
    if (vertical === 'THERAPIST')
      expect(fixture.run.mock.calls[0][0]).toMatchObject({ latencyMode: 'realtime' });
    else expect(fixture.run.mock.calls[0][0]).not.toHaveProperty('latencyMode');
  });

  it('starts a short Mind phrase at 2s after a full 400ms natural pause without weakening noise gates', async () => {
    const fixture = setup('THERAPIST');
    await deliver(fixture.session, pcm(1_600));
    await deliver(fixture.session, pcm(300, true));
    expect(fixture.run).not.toHaveBeenCalled();
    await deliver(fixture.session, pcm(100, true));
    expect(fixture.callTimes).toEqual([2_000]);
    expect(fixture.run.mock.calls[0][0].durationMs).toBe(2_000);
  });

  it('checks ready Mind audio within 250ms while Doctor keeps its one-second scheduler', async () => {
    const mind = setup('THERAPIST');
    const doctor = setup('DOCTOR');
    await vi.advanceTimersByTimeAsync(50);
    const ready = Buffer.concat([pcm(2_100), pcm(400, true)]);
    mind.session.pushAudio(ready);
    doctor.session.pushAudio(ready);
    await vi.advanceTimersByTimeAsync(199);
    expect(mind.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mind.callTimes).toEqual([250]);
    expect(doctor.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(doctor.callTimes).toEqual([1_000]);
  });

  it('keeps every accepted byte once and ordered through slow Pass1, a backlog and Pause', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const fixture = setup('THERAPIST', () => pending);
    const original = pcm(12_300);
    await deliver(fixture.session, original);
    expect(fixture.run).toHaveBeenCalledOnce();
    expect(fixture.callTimes).toEqual([4_000]);
    const pausing = fixture.session.pause(requestId);
    fixture.session.pushAudio(pcm(700)); // capture after Pause is refused
    expect(fixture.events.some((event) => event.type === 'capturePaused')).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(25);
    await pausing;
    expect(fixture.maxActive()).toBe(1);
    expect(fixture.run.mock.calls.map(([input]) => input.durationMs)).toEqual([
      4_000, 4_000, 4_000, 300,
    ]);
    expect(Buffer.concat(fixture.accepted)).toEqual(original);
    const words = fixture.events.flatMap((event) =>
      event.type === 'utterance' ? [event.utterance] : [],
    );
    expect(words.map((word) => [word.tStartMs, word.tEndMs])).toEqual([
      [0, 4_000],
      [4_000, 8_000],
      [8_000, 12_000],
      [12_000, 12_300],
    ]);
    expect(fixture.events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    expect(fixture.events.some((event) => event.type === 'therapyFinal')).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.run).toHaveBeenCalledTimes(4);
  });
});
