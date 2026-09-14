import { describe, expect, it, vi } from 'vitest';
import { LiveGatewayEventSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass1Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';

const ARTIFACT =
  'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';

function audio(ms: number, amplitude: number): Buffer {
  const pcm = Buffer.alloc(ms * 32);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(amplitude, i);
  return pcm;
}

function fixture(
  text = 'ഇന്ന് എനിക്ക് കുറച്ച് ആശ്വാസമുണ്ട്.',
  failed = false,
  segmentOnly = false,
) {
  const events: LiveGatewayEvent[] = [];
  const backend = new MockGeminiPass1Backend();
  const pass1 = vi.fn(async (input: Pass1Input) => {
    const result = await backend.run(input);
    result.output.transcript = segmentOnly ? 'Genuine speech.' : text;
    result.output.speakerSegments = segmentOnly
      ? [{ speaker: 'unknown', text, startMs: 0, endMs: input.durationMs }]
      : [];
    if (failed) result.callLog.status = 'ERROR';
    return result;
  });
  const pass2 = new MockGeminiPass2Backend();
  const note = vi.spyOn(pass2, 'run');
  const session = new LiveSession(
    'synthetic-quality',
    null,
    {
      backend: 'mock',
      pass1: { run: pass1 },
      pass2,
      reasoning: new MockGeminiReasoningBackend(),
      therapyReasoning: new MockGeminiTherapyReasoningBackend(),
    },
    (event) => events.push(event),
    undefined,
    undefined,
    undefined,
    'THERAPIST',
  );
  return { session, events, pass1, note };
}

describe('authoritative live transcription quality', () => {
  it.each(['pump', 'pause', 'end'] as const)(
    'never sends pure silence to Pass 1 during %s',
    async (action) => {
      const { session, events, pass1 } = fixture();
      session.pushAudio(audio(action === 'pump' ? 8_000 : 1_000, 0));
      if (action === 'pump') await session.pump();
      else if (action === 'pause') await session.pause('11111111-1111-4111-8111-111111111111');
      else await session.finalize();
      expect(pass1).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === 'utterance')).toBe(false);
      session.dispose();
    },
  );

  it('skips a mostly quiet tail but retains short genuine speech and realtime settings', async () => {
    const quiet = fixture();
    quiet.session.pushAudio(Buffer.concat([audio(20, 8_000), audio(980, 0)]));
    await quiet.session.finalize();
    expect(quiet.pass1).not.toHaveBeenCalled();
    quiet.session.dispose();

    const spoken = fixture();
    spoken.session.pushAudio(audio(300, 8_000));
    await spoken.session.finalize();
    expect(spoken.pass1).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ durationMs: 300, latencyMode: 'realtime' }),
    );
    expect(
      spoken.events.some(
        (event) => event.type === 'utterance' && event.utterance.text.includes('ആശ്വാസമുണ്ട്'),
      ),
    ).toBe(true);
    spoken.session.dispose();
  });

  it.each([
    [ARTIFACT, false, false],
    [
      'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the audio input.',
      false,
      false,
    ],
    [ARTIFACT, false, true],
    ['', true, false],
  ])('never publishes or analyses invalid output (%s)', async (text, failed, segmentOnly) => {
    const { session, events, pass1, note } = fixture(text, failed, segmentOnly);
    session.pushAudio(Buffer.concat([audio(3_000, 8_000), audio(800, 0)]));
    await session.pump();
    await session.pump();
    await session.finalize();
    expect(pass1).toHaveBeenCalledTimes(1);
    expect(note).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'transcript' || event.type === 'utterance')).toBe(
      false,
    );
    expect(events.filter((event) => event.type === 'transcriptionWarning')).toHaveLength(1);
    for (const event of events) expect(LiveGatewayEventSchema.safeParse(event).success).toBe(true);
    const meters = events.flatMap((event) => (event.type === 'meter' ? [event.summary] : []));
    expect(meters.at(-1)?.pass1Calls).toBe(1);
    session.dispose();
  });

  it('rejects an invalid final tail and keeps the warning on the final note', async () => {
    const { session, events, pass1 } = fixture();
    session.pushAudio(Buffer.concat([audio(3_000, 8_000), audio(800, 0)]));
    await session.pump();
    const backend = new MockGeminiPass1Backend();
    pass1.mockImplementationOnce(async (input) => {
      const result = await backend.run(input);
      result.output.transcript = ARTIFACT;
      result.output.speakerSegments = [];
      return result;
    });
    session.pushAudio(audio(300, 8_000));
    await session.finalize();
    const final = events.find((event) => event.type === 'therapyFinal');
    expect(final).toMatchObject({ type: 'therapyFinal', transcriptionWarning: true });
    expect(final && 'transcript' in final ? final.transcript : '').not.toContain('PLACEHOLDER');
    session.dispose();
  });

  it('does not revive legacy placeholder speech through a reconnect checkpoint', async () => {
    const { session, events, note } = fixture();
    session.seedResume([
      { id: 'u8', speaker: 'unknown', text: ARTIFACT, tStartMs: 4_000, tEndMs: 5_000 },
    ]);
    session.pushAudio(audio(300, 8_000));
    await session.finalize();
    expect(events).toContainEqual({ type: 'transcriptionWarning', startMs: 4_000, endMs: 5_000 });
    const utterance = events.find((event) => event.type === 'utterance');
    expect(utterance).toMatchObject({ utterance: { id: 'u9', tStartMs: 5_000 } });
    expect(note).toHaveBeenCalled();
    expect(JSON.stringify(note.mock.calls)).not.toContain('PLACEHOLDER');
    session.dispose();
  });
});
