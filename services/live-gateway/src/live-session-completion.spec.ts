import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveGatewayEventSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass1Input,
  type Pass2Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';

function speech(ms: number): Buffer {
  const audio = Buffer.alloc(ms * 32);
  for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(8_000, i);
  return audio;
}

const sessions: LiveSession[] = [];
async function fixture(vertical: 'DOCTOR' | 'THERAPIST' = 'DOCTOR') {
  const events: LiveGatewayEvent[] = [];
  const pass1 = new MockGeminiPass1Backend();
  const pass2Final = new MockGeminiPass2Backend();
  const session = new LiveSession(
    'fictional-completion-integrity',
    null,
    {
      backend: 'mock',
      pass1,
      pass2: new MockGeminiPass2Backend(),
      pass2Final,
      reasoning: new MockGeminiReasoningBackend(),
      therapyReasoning: new MockGeminiTherapyReasoningBackend(),
    },
    (event) => {
      expect(LiveGatewayEventSchema.safeParse(event).success).toBe(true);
      events.push(event);
    },
    undefined,
    undefined,
    undefined,
    vertical,
  );
  sessions.push(session);
  session.pushAudio(speech(6_000));
  await session.pump();
  await vi.waitFor(() =>
    expect(
      events.some((event) => event.type === (vertical === 'DOCTOR' ? 'note' : 'therapyNote')),
    ).toBe(true),
  );
  return { session, events, pass1, pass2Final };
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('therapist final capture integrity', () => {
  it('labels the interim fallback when the final note fails', async () => {
    const { session, events, pass2Final } = await fixture('THERAPIST');
    vi.spyOn(pass2Final, 'run').mockRejectedValueOnce(new Error('fictional note failure'));
    await session.finalize();
    expect(events.find((event) => event.type === 'therapyFinal')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'finalization_failed',
    });
  });

  it('retains audio loss when the closing speech cannot be transcribed', async () => {
    const { session, events, pass1 } = await fixture('THERAPIST');
    vi.spyOn(pass1, 'run').mockRejectedValueOnce(new Error('fictional tail failure'));
    session.pushAudio(speech(300));
    await session.finalize();
    expect(events.find((event) => event.type === 'therapyFinal')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'audio_loss',
    });
  });

  it('labels a timed-out final and fences its late result', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    const { session, events, pass2Final } = await fixture('THERAPIST');
    const mock = new MockGeminiPass2Backend();
    let release!: () => void;
    vi.spyOn(pass2Final, 'run').mockImplementationOnce(async (input: Pass2Input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return mock.run(input);
    });
    const finalizing = session.finalize();
    await vi.advanceTimersByTimeAsync(5_001);
    await finalizing;
    expect(events.filter((event) => event.type === 'therapyFinal')).toHaveLength(1);
    expect(events.find((event) => event.type === 'therapyFinal')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'finalization_failed',
    });
    const count = events.length;
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(count);
  });
});

describe('doctor final capture integrity', () => {
  it('flags a previous-note fallback when final note generation fails', async () => {
    const { session, events, pass2Final } = await fixture();
    vi.spyOn(pass2Final, 'run').mockRejectedValueOnce(new Error('fictional note failure'));

    await session.finalize();

    expect(events.find((event) => event.type === 'final')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'finalization_failed',
    });
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
  });

  it('flags a timed-out final and never lets its late result replace the incomplete fallback', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    const { session, events, pass2Final } = await fixture();
    const mock = new MockGeminiPass2Backend();
    let release!: () => void;
    vi.spyOn(pass2Final, 'run').mockImplementationOnce(async (input: Pass2Input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return mock.run(input);
    });

    const finalizing = session.finalize();
    await vi.advanceTimersByTimeAsync(5_001);
    await finalizing;
    const finalEvents = events.filter((event) => event.type === 'final');
    expect(finalEvents).toHaveLength(1);
    expect(finalEvents[0]).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'finalization_failed',
    });
    const terminalEventCount = events.length;
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(terminalEventCount);
  });

  it('retains an audio-loss marker when the closing tail cannot be transcribed', async () => {
    const { session, events, pass1 } = await fixture();
    vi.spyOn(pass1, 'run').mockRejectedValueOnce(new Error('fictional tail failure'));
    session.pushAudio(speech(300));

    await session.finalize();

    expect(events.find((event) => event.type === 'final')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'audio_loss',
    });
  });

  it.each(['pump', 'tail'] as const)(
    'persists a rejected %s transcription even when the final note succeeds',
    async (stage) => {
      const { session, events, pass1 } = await fixture();
      const mock = new MockGeminiPass1Backend();
      vi.spyOn(pass1, 'run').mockImplementationOnce(async (input: Pass1Input) => {
        const result = await mock.run(input);
        return {
          ...result,
          callLog: { ...result.callLog, status: 'ERROR' as const },
        };
      });
      session.pushAudio(speech(stage === 'pump' ? 6_000 : 300));
      if (stage === 'pump') await session.pump();

      await session.finalize();

      expect(events.some((event) => event.type === 'transcriptionWarning')).toBe(true);
      expect(events.find((event) => event.type === 'final')).toMatchObject({
        captureIncomplete: true,
        captureIncompleteReason: 'audio_loss',
      });
    },
  );
});
