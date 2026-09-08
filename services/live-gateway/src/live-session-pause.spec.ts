import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LiveGatewayCommandSchema,
  LiveGatewayEventSchema,
  type LiveGatewayEvent,
} from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass1Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import { OrderedSocketInput } from './ordered-socket-input';
import type { LiveBackends } from './llm';

const requestId = '00000000-0000-4000-8000-000000000001';
const pcm = (ms: number) => {
  const bytes = Buffer.alloc(ms * 32);
  for (let i = 0; i < bytes.length; i += 2) bytes.writeInt16LE(8000, i);
  return bytes;
};
function fixture() {
  const pass1 = new MockGeminiPass1Backend();
  const run = vi.spyOn(pass1, 'run');
  const backends: LiveBackends = {
    backend: 'mock',
    pass1,
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
    therapyReasoning: new MockGeminiTherapyReasoningBackend(),
  };
  const events: LiveGatewayEvent[] = [];
  const session = new LiveSession(
    'fictional-pause',
    null,
    backends,
    (e) => {
      expect(LiveGatewayEventSchema.safeParse(e).success).toBe(true);
      events.push(e);
    },
    undefined,
    undefined,
    undefined,
    'THERAPIST',
  );
  return { session, events, run };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('intentional live pause boundaries', () => {
  it('validates a correlated pause command and preserves old start/stop compatibility', () => {
    expect(LiveGatewayCommandSchema.parse({ type: 'pause', requestId })).toEqual({
      type: 'pause',
      requestId,
    });
    expect(LiveGatewayCommandSchema.safeParse({ type: 'pause' }).success).toBe(false);
    expect(LiveGatewayCommandSchema.safeParse({ type: 'stop' }).success).toBe(true);
    expect(
      LiveGatewayCommandSchema.safeParse({ type: 'start', sessionId: 'fictional' }).success,
    ).toBe(true);
  });

  it('acknowledges only after the short trailing audio is transcribed; ignores new audio until a fresh session', async () => {
    const { session, events, run } = fixture();
    session.start();
    session.pushAudio(pcm(300));
    let finish!: () => void;
    const mock = new MockGeminiPass1Backend();
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    const pausing = session.pause(requestId);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(events.some((e) => e.type === 'capturePaused')).toBe(false);
    session.pushAudio(pcm(400));
    finish();
    await pausing;
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0].audioBytes.length).toBe(pcm(300).length);
    expect(events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    expect(events.findIndex((e) => e.type === 'utterance')).toBeLessThan(events.length - 1);
    await session.pump();
    expect(run).toHaveBeenCalledOnce();
    expect(
      events.some(
        (e) => e.type === 'therapyFinal' || (e.type === 'status' && e.state === 'finalizing'),
      ),
    ).toBe(false);
    await session.finalize();
    expect(events.some((e) => e.type === 'status' && e.state === 'done')).toBe(true);
    session.dispose();
  });

  it('failed transcription keeps the same tail for explicit pause retry, never falsely acknowledges', async () => {
    const { session, events, run } = fixture();
    session.start();
    session.pushAudio(pcm(300));
    run.mockRejectedValueOnce(new Error('fixture failure'));
    await session.pause(requestId);
    expect(events.at(-1)).toEqual({ type: 'capturePauseFailed', requestId });
    await session.pause(requestId);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].audioBytes).toEqual(run.mock.calls[1][0].audioBytes);
    expect(events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    session.dispose();
  });

  it('bounds a slow pause attempt while a retry joins the same owned tail without a late old acknowledgement', async () => {
    vi.useFakeTimers();
    const { session, events, run } = fixture();
    const mock = new MockGeminiPass1Backend();
    let finish!: () => void;
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    session.start();
    session.pushAudio(pcm(300));
    const first = session.pause(requestId);
    await vi.advanceTimersByTimeAsync(25_001);
    expect(events).toContainEqual({ type: 'capturePauseFailed', requestId });
    await first;
    expect(events.some((e) => e.type === 'capturePaused')).toBe(false);

    const retryId = '00000000-0000-4000-8000-000000000002';
    const retry = session.pause(retryId);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    session.pushAudio(pcm(400));
    finish();
    await retry;
    expect(run).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === 'capturePaused')).toEqual([
      { type: 'capturePaused', requestId: retryId },
    ]);
    expect(run.mock.calls[0][0].audioBytes.length).toBe(pcm(300).length);
    session.dispose();
  });

  it('drains a queued pause tail in bounded audio windows instead of one oversized model request', async () => {
    const { session, events, run } = fixture();
    session.pushAudio(pcm(14_000));
    await session.pause(requestId);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map(([input]) => input.durationMs)).toEqual([6_000, 6_000, 2_000]);
    expect(run.mock.calls.reduce((sum, [input]) => sum + input.audioBytes.length, 0)).toBe(
      pcm(14_000).length,
    );
    expect(events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    session.dispose();
  });

  it('keeps completed windows when a later pause window fails and retries only remaining bytes', async () => {
    const { session, events, run } = fixture();
    const mock = new MockGeminiPass1Backend();
    run.mockImplementationOnce((input: Pass1Input) => mock.run(input));
    run.mockRejectedValueOnce(new Error('fictional second window failure'));
    session.pushAudio(pcm(14_000));
    await session.pause(requestId);
    expect(events.at(-1)).toEqual({ type: 'capturePauseFailed', requestId });
    await session.pause(requestId);
    expect(run.mock.calls.map(([input]) => input.durationMs)).toEqual([6_000, 6_000, 6_000, 2_000]);
    // The fixture returns two utterances per successful window. Their starts
    // must advance only once per consumed window, even after the retry.
    expect(
      events.filter((event) => event.type === 'utterance').map((event) => event.utterance.tStartMs),
    ).toEqual([0, 5_000, 6_000, 11_000, 12_000, 14_000]);
    expect(events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    session.dispose();
  });

  it('does not turn a timed-out attempt into a late successful pause without an explicit retry', async () => {
    vi.useFakeTimers();
    const { session, events, run } = fixture();
    const mock = new MockGeminiPass1Backend();
    let finish!: () => void;
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    session.pushAudio(pcm(300));
    const pausing = session.pause(requestId);
    await vi.advanceTimersByTimeAsync(25_001);
    await pausing;
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(events.some((event) => event.type === 'utterance')).toBe(true);
    expect(events.some((event) => event.type === 'capturePaused')).toBe(false);
    await session.pause(requestId);
    expect(events.at(-1)).toEqual({ type: 'capturePaused', requestId });
    expect(run).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('refuses incomplete End when a pre-pause pump stays busy beyond its idle budget', async () => {
    vi.useFakeTimers();
    const { session, events, run } = fixture();
    const mock = new MockGeminiPass1Backend();
    let finish!: () => void;
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    session.pushAudio(pcm(6_000));
    const pumping = session.pump();
    const pausing = session.pause(requestId);
    await vi.advanceTimersByTimeAsync(15_001);
    await pausing;
    expect(events.at(-1)).toEqual({ type: 'capturePauseFailed', requestId });
    const refused = expect(session.finalize()).rejects.toThrow('paused audio');
    await vi.advanceTimersByTimeAsync(15_001);
    await refused;
    const beforeLateResult = [...events];
    finish();
    await pumping;
    expect(events).toEqual(beforeLateResult);
    expect(run).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === 'therapyFinal')).toBe(false);
    session.dispose();
  });

  it('bounds shutdown of a stuck paused tail without treating shutdown as explicit End', async () => {
    vi.useFakeTimers();
    const { session, events, run } = fixture();
    run.mockImplementationOnce(() => new Promise(() => {}));
    session.pushAudio(pcm(300));
    const pausing = session.pause(requestId);
    const shutdown = session.finalizeForShutdown();
    await vi.advanceTimersByTimeAsync(25_001);
    await Promise.all([pausing, shutdown]);
    expect(events).toEqual([{ type: 'capturePauseFailed', requestId }]);
    expect(run).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('bounds explicit End after a stuck pause and suppresses late audio rather than finalizing incomplete content', async () => {
    vi.useFakeTimers();
    const { session, events, run } = fixture();
    const mock = new MockGeminiPass1Backend();
    let finish!: () => void;
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    session.pushAudio(pcm(300));
    const pausing = session.pause(requestId);
    await vi.advanceTimersByTimeAsync(25_001);
    expect(events).toContainEqual({ type: 'capturePauseFailed', requestId });
    await pausing;
    const ending = session.finalize();
    const refused = expect(ending).rejects.toThrow('paused audio');
    await vi.advanceTimersByTimeAsync(25_001);
    await refused;
    const beforeLateResult = [...events];
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(beforeLateResult);
    expect(run).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === 'therapyFinal')).toBe(false);
    session.dispose();
  });

  it('disposal while tail transcription is pending suppresses stale pause acknowledgement', async () => {
    const { session, events, run } = fixture();
    let finish!: () => void;
    const mock = new MockGeminiPass1Backend();
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    session.pushAudio(pcm(300));
    const pausing = session.pause(requestId);
    await vi.waitFor(() => expect(finish).toBeDefined());
    session.dispose();
    finish();
    await pausing;
    expect(events).toEqual([]);
  });

  it('a paused session does not auto-finalize when its wall-clock duration ceiling passes', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVE_MAX_CONSULT_MS', '60000');
    const { session, events } = fixture();
    session.start();
    await session.pause(requestId);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events).toEqual([
      { type: 'status', state: 'listening' },
      { type: 'capturePaused', requestId },
    ]);
    session.dispose();
  });

  it('explicit End joins an in-flight pause tail instead of transcribing it twice', async () => {
    const { session, events, run } = fixture();
    session.start();
    session.pushAudio(pcm(300));
    let finish!: () => void;
    const mock = new MockGeminiPass1Backend();
    run.mockImplementationOnce(async (input: Pass1Input) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return mock.run(input);
    });
    const pausing = session.pause(requestId);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const ending = session.finalize();
    expect(events.some((e) => e.type === 'status' && e.state === 'finalizing')).toBe(false);
    finish();
    await Promise.all([pausing, ending]);
    expect(run).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    session.dispose();
  });

  it('gateway shutdown leaves an intentional pause unfinalized', async () => {
    const { session, events } = fixture();
    session.start();
    await session.pause(requestId);
    await session.finalizeForShutdown();
    expect(events).toEqual([
      { type: 'status', state: 'listening' },
      { type: 'capturePaused', requestId },
    ]);
    session.dispose();
  });

  it('fresh-socket resume preserves acknowledged elapsed time for pacing and freezes it during pause', async () => {
    vi.useFakeTimers();
    const { session, events } = fixture();
    session.seedResume([
      {
        id: 'u1',
        speaker: 'patient',
        text: 'Fictional prior session speech.',
        tStartMs: 0,
        tEndMs: 30_000,
      },
    ]);
    session.start();
    await vi.advanceTimersByTimeAsync(15_000);
    await session.pause(requestId);
    await vi.advanceTimersByTimeAsync(30_000);
    await session.finalize();
    const meter = events.filter((event) => event.type === 'meter').at(-1);
    expect(meter?.summary.elapsedMs).toBe(45_000);
    session.dispose();
  });

  it('replayed elapsed time cannot reset the consultation duration ceiling', async () => {
    vi.stubEnv('LIVE_MAX_CONSULT_MS', '60000');
    const { session, events } = fixture();
    session.seedResume([
      {
        id: 'u1',
        speaker: 'patient',
        text: 'Fictional prior session speech.',
        tStartMs: 0,
        tEndMs: 61_000,
      },
    ]);
    session.start();
    session.pushAudio(pcm(6_000));
    await session.pump();
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'status', state: 'done' }));
    const meter = events.filter((event) => event.type === 'meter').at(-1);
    expect(meter?.summary.elapsedMs).toBeGreaterThanOrEqual(61_000);
    session.dispose();
  });
});

describe('ordered socket input', () => {
  it('slow preceding audio authorization cannot be overtaken by pause or following audio', async () => {
    const applied: string[] = [];
    const queue = new OrderedSocketInput(() => {
      throw new Error('unexpected failure');
    });
    let authorize!: () => void;
    const authorized = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    queue.enqueue(async () => {
      await authorized;
      applied.push('audio');
    });
    queue.enqueue(async () => {
      applied.push('pause');
    });
    queue.enqueue(async () => {
      applied.push('later audio');
    });
    await Promise.resolve();
    expect(applied).toEqual([]);
    authorize();
    await queue.drain();
    expect(applied).toEqual(['audio', 'pause', 'later audio']);
  });

  it('disposal drops queued input and queue overload closes rather than growing indefinitely', async () => {
    const failure = vi.fn();
    const work = vi.fn(async () => {});
    const queue = new OrderedSocketInput(failure, 1);
    queue.enqueue(work);
    queue.enqueue(work);
    await queue.drain();
    expect(failure).toHaveBeenCalledOnce();
    expect(work).not.toHaveBeenCalled();
  });
});
