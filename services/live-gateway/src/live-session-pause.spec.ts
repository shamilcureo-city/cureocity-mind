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
