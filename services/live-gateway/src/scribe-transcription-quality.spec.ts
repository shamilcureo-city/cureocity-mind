import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  containsMedicalTranscriptionExample,
  LiveGatewayEventSchema,
  type LiveGatewayEvent,
  type PractitionerVertical,
  type Utterance,
} from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass1Input,
  type SpeakerSegment,
} from '@cureocity/llm';
import { LiveSession } from './live-session';

const LEGACY_EXAMPLE = 'BP 130/80, PR 88, SpO2 97%, HbA1c 7.2, FBS 140, creatinine 1.1.';
const EXAMPLE_PARTS = ['BP 130/80, PR 88,', 'SpO2 97%, HbA1c 7.2,', 'FBS 140, creatinine 1.1.'];
const GOOD_SPEECH = 'ഇന്ന് എനിക്ക് കുറച്ച് ആശ്വാസമുണ്ട്. BP 120/80, pulse 72.';
const sessions: LiveSession[] = [];

function audio(ms: number, amplitude = 8_000): Buffer {
  const pcm = Buffer.alloc(ms * 32);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(amplitude, i);
  return pcm;
}

function fixture(vertical: PractitionerVertical = 'DOCTOR') {
  const events: LiveGatewayEvent[] = [];
  const mock = new MockGeminiPass1Backend();
  const pass1 = vi.fn(async (input: Pass1Input) => {
    const result = await mock.run(input);
    result.output.transcript = GOOD_SPEECH;
    result.output.speakerSegments = [];
    return result;
  });
  const pass2 = new MockGeminiPass2Backend();
  const note = vi.spyOn(pass2, 'run');
  const reasoningBackend = new MockGeminiReasoningBackend();
  const reasoning = vi.spyOn(reasoningBackend, 'run');
  const session = new LiveSession(
    'fictional-scribe-example-quarantine',
    null,
    {
      backend: 'mock',
      pass1: { run: pass1 },
      pass2,
      reasoning: reasoningBackend,
      therapyReasoning: new MockGeminiTherapyReasoningBackend(),
    },
    (event) => {
      expect(LiveGatewayEventSchema.safeParse(event).success).toBe(true);
      events.push(event);
    },
    undefined,
    undefined,
    0,
    vertical,
  );
  sessions.push(session);
  const next = (transcript: string, segments: SpeakerSegment[] = []) => {
    pass1.mockImplementationOnce(async (input) => {
      const result = await mock.run(input);
      result.output.transcript = transcript;
      result.output.speakerSegments = segments;
      return result;
    });
  };
  return { session, events, pass1, note, reasoning, next };
}

function replay(texts: string[]): Utterance[] {
  return texts.map((text, index) => ({
    id: `u${index + 1}`,
    speaker: 'doctor',
    text,
    tStartMs: index * 1_000,
    tEndMs: (index + 1) * 1_000,
  }));
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});

describe('Scribe retired transcription-example quarantine', () => {
  it.each(['transcript', 'segment', 'split segments'] as const)(
    'blocks the known %s fingerprint before publishing or downstream analysis',
    async (representation) => {
      const { session, events, pass1, note, reasoning, next } = fixture();
      const segments = (representation === 'split segments' ? EXAMPLE_PARTS : [LEGACY_EXAMPLE]).map(
        (text, index) => ({
          speaker: 'therapist' as const,
          text,
          startMs: index * 1_000,
          endMs: (index + 1) * 1_000,
        }),
      );
      next(
        representation === 'transcript' ? LEGACY_EXAMPLE : GOOD_SPEECH,
        representation === 'transcript' ? [] : segments,
      );
      session.pushAudio(audio(6_000));
      await session.pump();
      await session.finalize();
      expect(pass1).toHaveBeenCalledTimes(1);
      expect(note).not.toHaveBeenCalled();
      expect(reasoning).not.toHaveBeenCalled();
      expect(
        events.some((event) =>
          ['transcript', 'utterance', 'note', 'final', 'rxPad', 'command'].includes(event.type),
        ),
      ).toBe(false);
      expect(events.filter((event) => event.type === 'transcriptionWarning')).toHaveLength(1);
      expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    },
  );

  it.each(['pump', 'pause', 'tail'] as const)(
    'keeps earlier genuine speech and persists incomplete capture when a %s is quarantined',
    async (stage) => {
      const { session, events, note, reasoning, next } = fixture();
      session.pushAudio(audio(6_000));
      await session.pump();
      next(LEGACY_EXAMPLE);
      session.pushAudio(audio(stage === 'pump' ? 6_000 : 300));
      if (stage === 'pump') await session.pump();
      if (stage === 'pause') await session.pause('11111111-1111-4111-8111-111111111111');
      await session.finalize();
      expect(events.filter((event) => event.type === 'utterance')).toHaveLength(1);
      expect(events.find((event) => event.type === 'utterance')).toMatchObject({
        utterance: { text: GOOD_SPEECH },
      });
      expect(events.find((event) => event.type === 'final')).toMatchObject({
        captureIncomplete: true,
        captureIncompleteReason: 'audio_loss',
      });
      expect(events.filter((event) => event.type === 'transcriptionWarning')).toHaveLength(1);
      for (const calls of [note.mock.calls, reasoning.mock.calls]) {
        expect(containsMedicalTranscriptionExample(JSON.stringify(calls))).toBe(false);
      }
    },
  );

  it('rejects a final tail whose example exists only across diarized segments', async () => {
    const { session, events, note, reasoning, next } = fixture();
    next(
      GOOD_SPEECH,
      EXAMPLE_PARTS.map((text, index) => ({
        speaker: 'therapist',
        text,
        startMs: index * 100,
        endMs: (index + 1) * 100,
      })),
    );
    session.pushAudio(audio(300));
    await session.finalize();
    expect(note).not.toHaveBeenCalled();
    expect(reasoning).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'utterance')).toBe(false);
    expect(events.filter((event) => event.type === 'transcriptionWarning')).toHaveLength(1);
  });

  it('quarantines split and repeated replay fingerprints without discarding unaffected turns', async () => {
    const { session, events, note, reasoning } = fixture();
    const texts = ['Cough started yesterday.', ...EXAMPLE_PARTS, 'No fever.', LEGACY_EXAMPLE];
    session.seedResume(replay(texts));
    session.pushAudio(audio(300));
    await session.finalize();
    expect(events.filter((event) => event.type === 'transcriptionWarning')).toHaveLength(4);
    expect(events.find((event) => event.type === 'utterance')).toMatchObject({
      utterance: { id: 'u7', tStartMs: 6_000, text: GOOD_SPEECH },
    });
    expect(note).toHaveBeenCalled();
    expect(note.mock.calls.at(-1)?.[0].transcript).toBe(
      `Cough started yesterday. No fever. ${GOOD_SPEECH}`,
    );
    expect(events.find((event) => event.type === 'final')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'audio_loss',
    });
    expect(containsMedicalTranscriptionExample(JSON.stringify(note.mock.calls))).toBe(false);
    expect(containsMedicalTranscriptionExample(JSON.stringify(reasoning.mock.calls))).toBe(false);
  });

  it.each([
    'BP 130/80.',
    'PR 88, SpO2 97%.',
    'HbA1c 7.2, FBS 140, creatinine 1.1.',
    'BP 130/80, PR 89, SpO2 97%, HbA1c 7.2, FBS 140, creatinine 1.1.',
    GOOD_SPEECH,
  ])('preserves ordinary or code-mixed clinical speech unchanged: %s', async (text) => {
    const { session, events, note, next } = fixture();
    next(text);
    session.pushAudio(audio(300));
    await session.finalize();
    expect(events.find((event) => event.type === 'utterance')).toMatchObject({
      utterance: { text },
    });
    expect(note.mock.calls[0]?.[0].transcript).toBe(text);
    expect(events.some((event) => event.type === 'transcriptionWarning')).toBe(false);
  });

  it('skips quiet input and accepts a provider no-speech response without manufacturing a warning', async () => {
    const { session, events, pass1, note } = fixture();
    session.pushAudio(Buffer.concat([audio(20), audio(980, 0)]));
    await session.pause('11111111-1111-4111-8111-111111111111');
    expect(pass1).not.toHaveBeenCalled();
    const noSpeech = fixture();
    noSpeech.next('');
    noSpeech.session.pushAudio(audio(300));
    await noSpeech.session.finalize();
    expect(noSpeech.pass1).toHaveBeenCalledTimes(1);
    expect(noSpeech.note).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(
      [...events, ...noSpeech.events].some(
        (event) => event.type === 'utterance' || event.type === 'transcriptionWarning',
      ),
    ).toBe(false);
  });

  it('does not change Mind transcript, replay or provisional-rail behavior', async () => {
    const { session, events, note, next } = fixture('THERAPIST');
    session.seedResume(replay(EXAMPLE_PARTS));
    session.handleStreamPartial(LEGACY_EXAMPLE);
    next(LEGACY_EXAMPLE);
    session.pushAudio(audio(300));
    await session.finalize();
    expect(events).toContainEqual({ type: 'partialTranscript', text: LEGACY_EXAMPLE });
    expect(events.find((event) => event.type === 'utterance')).toMatchObject({
      utterance: { text: LEGACY_EXAMPLE },
    });
    expect(note).toHaveBeenCalled();
    expect(note.mock.calls[0]?.[0].transcript).toContain(LEGACY_EXAMPLE);
    expect(events.some((event) => event.type === 'transcriptionWarning')).toBe(false);
  });

  it('clears the provisional line when its accumulated fragments match the retired example', () => {
    const { session, events } = fixture();
    for (const part of EXAMPLE_PARTS) session.handleStreamPartial(`${part} `);
    expect(events).toContainEqual({ type: 'partialTranscript', text: '' });
    expect(events.some((event) => event.type === 'transcriptionWarning')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'partialTranscript' && containsMedicalTranscriptionExample(event.text),
      ),
    ).toBe(false);
  });

  it('quarantines a note backend echo before note or prescription output can publish', async () => {
    const { session, events, note } = fixture();
    const mock = new MockGeminiPass2Backend();
    note.mockImplementationOnce(async (input) => {
      const result = await mock.run(input);
      if (result.output.kind === 'MEDICAL') {
        result.output.encounterNote.hpi = LEGACY_EXAMPLE;
      }
      return result;
    });
    session.pushAudio(audio(300));
    await session.finalize();
    expect(events.some((event) => ['note', 'final', 'rxPad'].includes(event.type))).toBe(false);
    expect(events.some((event) => event.type === 'transcriptionWarning')).toBe(true);
  });
});
