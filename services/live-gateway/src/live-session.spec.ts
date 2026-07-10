import { describe, expect, it } from 'vitest';
import { LiveGatewayEventSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  type GeminiCallLogData,
  type IPass1Backend,
  type IPassReasoningBackend,
  type Pass1Input,
  type PassReasoningInput,
  type PassReasoningOutput,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';
import type { WindowOptions } from './vad';

function pcm(ms: number, amplitude: number, sampleRate = 16_000): Buffer {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(amplitude, i * 2);
  return buf;
}

const SPEECH = 8_000;
const SILENCE = 0;

// Small windows keep the test fast + deterministic (no reliance on timers).
const OPTS: WindowOptions = {
  sampleRate: 16_000,
  frameMs: 20,
  threshold: 0.015,
  minWindowMs: 4_000,
  maxWindowMs: 8_000,
  silenceMs: 400,
};

function mockBackends(): LiveBackends {
  return {
    backend: 'mock',
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
  };
}

/** One "utterance" of audio: 5s of speech + a 0.5s pause. */
const BLOCK = Buffer.concat([pcm(5_000, SPEECH), pcm(500, SILENCE)]);

describe('LiveSession — per-segment diarized utterances (TS-B1)', () => {
  it('splits a multi-speaker window into speaker-correct utterances', async () => {
    const events: LiveGatewayEvent[] = [];
    // The mock Pass 1 returns TWO diarized segments per window
    // (therapist greeting + client reply) — previously collapsed into one
    // utterance labeled with the LAST segment's speaker.
    const session = new LiveSession('sess-diar', null, mockBackends(), (e) => events.push(e), OPTS);
    session.pushAudio(BLOCK);
    await session.pump();

    const utterances = events.flatMap((e) => (e.type === 'utterance' ? [e.utterance] : []));
    expect(utterances).toHaveLength(2);
    expect(utterances[0]!.speaker).toBe('doctor'); // therapist slot
    expect(utterances[0]!.text).toContain('How have things been');
    expect(utterances[1]!.speaker).toBe('patient'); // client slot
    expect(utterances[1]!.text).toContain('breathing exercises');
    // Sequential ids, ordered non-inverted times inside the window.
    expect(utterances.map((u) => u.id)).toEqual(['u1', 'u2']);
    for (const u of utterances) expect(u.tEndMs).toBeGreaterThanOrEqual(u.tStartMs);
    session.dispose();
  });

  it('falls back to ONE unknown-speaker utterance when diarization is empty', async () => {
    class NoSegmentsPass1 implements IPass1Backend {
      private readonly inner = new MockGeminiPass1Backend();
      async run(input: Pass1Input) {
        const r = await this.inner.run(input);
        return {
          output: { ...r.output, transcript: 'undiarized speech', speakerSegments: [] },
          callLog: r.callLog,
        };
      }
    }
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-noseg',
      null,
      { ...mockBackends(), pass1: new NoSegmentsPass1() },
      (e) => events.push(e),
      OPTS,
    );
    session.pushAudio(BLOCK);
    await session.pump();
    const utterances = events.flatMap((e) => (e.type === 'utterance' ? [e.utterance] : []));
    expect(utterances).toHaveLength(1);
    expect(utterances[0]!.speaker).toBe('unknown');
    expect(utterances[0]!.text).toBe('undiarized speech');
    session.dispose();
  });
});

describe('LiveSession — incremental windowing + metering (DS0)', () => {
  it('emits schema-valid events, one utterance per window, and a final note + meter', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-live',
      'Cardiology',
      mockBackends(),
      (e) => {
        // Contracts-first: every event on the wire must validate.
        expect(LiveGatewayEventSchema.safeParse(e).success).toBe(true);
        events.push(e);
      },
      OPTS,
    );

    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const utterancesMid = events.filter((e) => e.type === 'utterance');
    expect(utterancesMid.length).toBeGreaterThanOrEqual(3);
    // Utterances carry monotonic ids + non-decreasing time bounds.
    for (let i = 0; i < utterancesMid.length; i++) {
      const u = utterancesMid[i]!;
      if (u.type !== 'utterance') continue;
      expect(u.utterance.id).toBe(`u${i + 1}`);
      expect(u.utterance.tEndMs).toBeGreaterThanOrEqual(u.utterance.tStartMs);
    }

    // The note rail builds during the consult (not only at the end).
    expect(events.some((e) => e.type === 'note')).toBe(true);

    // Sprint DS1 — findings extracted + emitted, converging (stable ids), and
    // every rendered finding cites a real utterance id (the citation gate).
    const findingEvents = events.filter((e) => e.type === 'finding');
    expect(findingEvents.length).toBeGreaterThan(0);
    const knownUtteranceIds = new Set(
      events.flatMap((e) => (e.type === 'utterance' ? [e.utterance.id] : [])),
    );
    const lastFinding = findingEvents[findingEvents.length - 1]!;
    let knownFindingIds = new Set<string>();
    if (lastFinding.type === 'finding') {
      // Converges to the mock's stable set (f1/f2/f3), not N×windows dupes.
      expect(lastFinding.findings.length).toBe(3);
      // Includes at least one explicit negative.
      expect(lastFinding.findings.some((f) => f.kind === 'negative')).toBe(true);
      // Every finding cites a real utterance id.
      for (const f of lastFinding.findings) {
        expect(f.utteranceIds.length).toBeGreaterThan(0);
        for (const id of f.utteranceIds) expect(knownUtteranceIds.has(id)).toBe(true);
      }
      knownFindingIds = new Set(lastFinding.findings.map((f) => f.id));
    }

    // Sprint DS2 — the differential appears, is ranked + capped, urgent-marked,
    // and every rendered candidate cites a REAL finding id (the citation gate).
    const reasoningEvents = events.filter((e) => e.type === 'reasoning');
    expect(reasoningEvents.length).toBeGreaterThan(0);
    const lastReasoning = reasoningEvents[reasoningEvents.length - 1]!;
    if (lastReasoning.type === 'reasoning') {
      const dx = lastReasoning.reasoning.differential;
      expect(dx.length).toBeGreaterThanOrEqual(1);
      expect(dx.length).toBeLessThanOrEqual(5);
      expect(dx.some((d) => d.urgent)).toBe(true);
      for (const d of dx) {
        expect(d.evidenceFor.length).toBeGreaterThan(0);
        for (const id of d.evidenceFor) expect(knownFindingIds.has(id)).toBe(true);
      }
      // Ask-next present; never more than 3 OPEN differential-driven (DS3).
      const openDifferential = lastReasoning.reasoning.askNext.filter(
        (a) => a.source === 'DIFFERENTIAL' && a.status === 'open',
      );
      expect(openDifferential.length).toBeLessThanOrEqual(3);
      // Template-driven questions interleave too (specialty = Cardiology).
      expect(lastReasoning.reasoning.askNext.some((a) => a.source === 'TEMPLATE')).toBe(true);
      expect(lastReasoning.reasoning.version).toBeGreaterThan(0);
    }

    await session.finalize();

    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);

    const meters = events.filter((e) => e.type === 'meter');
    expect(meters.length).toBeGreaterThan(0);
    const lastMeter = meters[meters.length - 1]!;
    if (lastMeter.type === 'meter') {
      expect(lastMeter.summary.windows).toBeGreaterThanOrEqual(3);
      expect(lastMeter.summary.pass1Calls).toBe(lastMeter.summary.windows);
      expect(lastMeter.summary.backend).toBe('mock');
      expect(Number.isInteger(lastMeter.summary.inputTokens)).toBe(true);
    }
  });

  it('keeps per-window transcription tokens flat — O(n), not O(n²)', async () => {
    const session = new LiveSession('sess-on', 'Cardiology', mockBackends(), () => {}, OPTS);
    session.start();
    // Five uniform utterances streamed in one shot.
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const tokens = [...session.transcribeTokenSamples];
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    const first = tokens[0]!;
    const last = tokens[tokens.length - 1]!;
    expect(first).toBeGreaterThan(0);
    // The whole point of DS0: the last window costs ~the same as the first.
    expect(Math.abs(last - first) / first).toBeLessThanOrEqual(0.2);

    session.dispose();
  });

  it('auto-resolves an ask-next question the next reasoning cycle reports answered (DS3)', async () => {
    // The mock ASR text is fixed, so drive auto-resolution with a scripted
    // reasoning backend: cycle 1 opens q1, cycle 2 reports it answered.
    const fakeLog: GeminiCallLogData = {
      sessionId: 's',
      pass: 'PASS_11_REASONING',
      model: 'test',
      region: 'test',
      promptVersion: 'test',
      inputTokens: 1,
      outputTokens: 1,
      costInr: 0,
      latencyMs: 0,
      status: 'SUCCESS',
    };
    const dx = [
      {
        id: 'd1',
        label: 'ACS',
        likelihood: 'high' as const,
        trend: 'new' as const,
        urgent: true,
        evidenceFor: ['f1'],
        evidenceAgainst: [],
      },
    ];
    class ScriptedReasoning implements IPassReasoningBackend {
      calls = 0;
      async run(
        input: PassReasoningInput,
      ): Promise<{ output: PassReasoningOutput; callLog: GeminiCallLogData }> {
        this.calls += 1;
        const anchor = input.newUtterances[0]!;
        const findings =
          this.calls === 1
            ? [
                {
                  id: 'f1',
                  kind: 'symptom' as const,
                  label: 'chest pain',
                  utteranceIds: [anchor.id],
                  polarity: 'present' as const,
                },
              ]
            : [];
        const askNext =
          this.calls === 1
            ? [
                {
                  id: 'q1',
                  question: 'Does the pain radiate to the arm?',
                  why: 'ACS vs MSK',
                  targetDxIds: ['d1'],
                  source: 'DIFFERENTIAL' as const,
                  priority: 'high' as const,
                  status: 'open' as const,
                },
              ]
            : [];
        return {
          output: {
            findings,
            answeredQuestionIds: this.calls >= 2 ? ['q1'] : [],
            differential: dx,
            askNext,
            redFlags: [],
            examineNext: [],
            orderNext: [],
          },
          callLog: fakeLog,
        };
      }
    }

    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-resolve',
      null,
      {
        backend: 'mock',
        pass1: new MockGeminiPass1Backend(),
        pass2: new MockGeminiPass2Backend(),
        reasoning: new ScriptedReasoning(),
      },
      (e) => events.push(e),
      OPTS,
    );
    session.start();
    session.pushAudio(BLOCK);
    await session.pump(); // cycle 1 — q1 opens
    await session.finalize(); // cycle 2 — q1 answered

    const reasoningEvents = events.filter((e) => e.type === 'reasoning');
    const sawOpen = reasoningEvents.some(
      (e) =>
        e.type === 'reasoning' &&
        e.reasoning.askNext.some((q) => q.id === 'q1' && q.status === 'open'),
    );
    const sawAnswered = reasoningEvents.some(
      (e) =>
        e.type === 'reasoning' &&
        e.reasoning.askNext.some((q) => q.id === 'q1' && q.status === 'answered'),
    );
    expect(sawOpen).toBe(true);
    expect(sawAnswered).toBe(true);
  });

  it('finalizes cleanly with no audio (no window ever closed)', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-empty',
      null,
      mockBackends(),
      (e) => events.push(e),
      OPTS,
    );
    session.start();
    await session.finalize();

    // No final note (nothing was transcribed) but the lifecycle still closes.
    expect(events.some((e) => e.type === 'status' && e.state === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'meter')).toBe(true);
    expect(events.some((e) => e.type === 'final')).toBe(false);
  });
});

describe('LiveSession — interim-note debounce + final routing (Sprint 74)', () => {
  class CountingPass2 extends MockGeminiPass2Backend {
    calls = 0;
    override run(...args: Parameters<MockGeminiPass2Backend['run']>) {
      this.calls += 1;
      return super.run(...args);
    }
  }

  function build(noteRefreshMs: number) {
    const interim = new CountingPass2();
    const final = new CountingPass2();
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-debounce',
      null,
      {
        backend: 'mock',
        pass1: new MockGeminiPass1Backend(),
        pass2: interim,
        pass2Final: final,
        reasoning: new MockGeminiReasoningBackend(),
      },
      (e) => events.push(e),
      OPTS,
      undefined,
      noteRefreshMs,
    );
    return { session, interim, final, events };
  }

  it('runs the first interim note, debounces the rest, and finalizes on pass2Final', async () => {
    const { session, interim, final, events } = build(100_000);
    session.start();
    // Five utterances ≈ 27.5 s — far below the 100 s refresh threshold.
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK, BLOCK, BLOCK]));
    await session.pump();

    // First window ran a note (the doctor sees one early); later windows debounced.
    expect(interim.calls).toBe(1);
    expect(final.calls).toBe(0);
    expect(events.some((e) => e.type === 'note')).toBe(true);

    await session.finalize();
    // Finalize is never debounced and uses the authoritative backend.
    expect(final.calls).toBe(1);
    expect(interim.calls).toBe(1);
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
  });

  it('refreshMs=0 restores note-per-window (the old behaviour)', async () => {
    const { session, interim } = build(0);
    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();
    // Every closed window re-ran the interim note.
    expect(interim.calls).toBeGreaterThanOrEqual(3);
    session.dispose();
  });

  it('falls back to pass2 for the final when pass2Final is absent', async () => {
    const interim = new CountingPass2();
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-fallback',
      null,
      {
        backend: 'mock',
        pass1: new MockGeminiPass1Backend(),
        pass2: interim,
        reasoning: new MockGeminiReasoningBackend(),
      },
      (e) => events.push(e),
      OPTS,
      undefined,
      100_000,
    );
    session.start();
    session.pushAudio(BLOCK);
    await session.pump();
    await session.finalize();
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
    expect(interim.calls).toBe(2); // first window + finalize
  });

  it('DOC-2: deterministic red flags run at finalize (previously skipped on the isFinal path)', async () => {
    // A red flag spoken in the closing seconds. Before DOC-2, the isFinal path
    // emitted `final` and returned BEFORE the gap block, so this never fired.
    class ScriptedPass1 implements IPass1Backend {
      private readonly inner = new MockGeminiPass1Backend();
      constructor(private readonly transcript: string) {}
      async run(input: Pass1Input) {
        const r = await this.inner.run(input);
        // TS-B1 — utterance text now comes from the diarized segments, so a
        // scripted transcript must script its segment too (as real Pass 1
        // keeps them consistent).
        return {
          output: {
            ...r.output,
            transcript: this.transcript,
            speakerSegments: [
              {
                speaker: 'client' as const,
                startMs: 0,
                endMs: input.durationMs,
                text: this.transcript,
                language: 'en',
              },
            ],
          },
          callLog: r.callLog,
        };
      }
    }
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-doc2',
      'Cardiology',
      {
        backend: 'mock',
        pass1: new ScriptedPass1('now with sudden chest pain radiating to the arm'),
        pass2: new MockGeminiPass2Backend(),
        reasoning: new MockGeminiReasoningBackend(),
      },
      (e) => {
        expect(LiveGatewayEventSchema.safeParse(e).success).toBe(true);
        events.push(e);
      },
      OPTS,
    );
    // No start() — drive the tail synchronously through finalize (no pump timer).
    session.pushAudio(BLOCK);
    await session.finalize();

    const redFlags = events
      .filter((e): e is Extract<LiveGatewayEvent, { type: 'gap' }> => e.type === 'gap')
      .filter((e) => e.gap.kind === 'RED_FLAG');
    // The chest-pain red flag reaches the doctor even though it was only ever
    // spoken in the finalize window.
    expect(redFlags.some((e) => /chest pain/i.test(e.gap.message))).toBe(true);
    // And the consult still closed.
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
  });

  it('DOC-5: a fully-silent window skips Pass 1 (dead air costs nothing)', async () => {
    let pass1Calls = 0;
    class CountingPass1 implements IPass1Backend {
      private readonly inner = new MockGeminiPass1Backend();
      async run(input: Pass1Input) {
        pass1Calls++;
        return this.inner.run(input);
      }
    }
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-silent',
      'Cardiology',
      {
        backend: 'mock',
        pass1: new CountingPass1(),
        pass2: new MockGeminiPass2Backend(),
        reasoning: new MockGeminiReasoningBackend(),
      },
      (e) => events.push(e),
      OPTS,
    );
    // 9s of pure silence → force-cut into a silent window at maxWindowMs (8s).
    session.pushAudio(pcm(9_000, SILENCE));
    await session.pump();
    expect(pass1Calls).toBe(0);
    expect(events.filter((e) => e.type === 'transcript')).toHaveLength(0);
  });

  it('DOC-5: auto-finalizes when a runaway guard trips (forgotten mic)', async () => {
    const events: LiveGatewayEvent[] = [];
    // No start() → startedAtMs stays 0, so the elapsed-time guard trips on the
    // first processed window — a proxy for a consult that ran past the cap.
    const session = new LiveSession(
      'sess-runaway',
      'Cardiology',
      mockBackends(),
      (e) => events.push(e),
      OPTS,
    );
    session.pushAudio(BLOCK);
    await session.pump(); // processes a window → guard trips → schedules finalize
    await new Promise((r) => setTimeout(r, 40)); // let the fire-and-forget finalize settle
    expect(events.some((e) => e.type === 'final')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.state === 'done')).toBe(true);
  });
});

describe('LiveSession — cross-visit drug interactions (DOC-3)', () => {
  it('flags a prior active med interacting with a drug drafted today', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-doc3',
      'Cardiology',
      mockBackends(),
      (e) => events.push(e),
      OPTS,
      // The patient is on standing warfarin from a prior encounter — the
      // context the token route now seeds. The mock note drafts [mock]
      // Aspirin today, which interacts with warfarin (bleeding risk).
      { sex: 'unknown', knownConditions: [], allergies: [], activeMeds: ['Warfarin 5mg'] },
    );
    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const drugGaps = events.filter((e) => e.type === 'gap' && e.gap.kind === 'DRUG_INTERACTION');
    expect(drugGaps.some((e) => e.type === 'gap' && /warfarin/i.test(e.gap.message))).toBe(true);
  });

  it('does not raise a cross-visit flag when there is no interacting prior med', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-doc3b',
      'Cardiology',
      mockBackends(),
      (e) => events.push(e),
      OPTS,
      { sex: 'unknown', knownConditions: [], allergies: [], activeMeds: [] },
    );
    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const drugGaps = events.filter((e) => e.type === 'gap' && e.gap.kind === 'DRUG_INTERACTION');
    // The mock's own drafted meds don't mention warfarin — no cross-visit flag.
    expect(drugGaps.some((e) => e.type === 'gap' && /warfarin/i.test(e.gap.message))).toBe(false);
  });
});
