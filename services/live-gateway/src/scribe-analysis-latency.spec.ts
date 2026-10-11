import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiveGatewayEventSchema,
  type LiveGatewayEvent,
  type PatientContext,
  type PractitionerCapability,
} from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type Pass2Input,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Synthetic PCM and manually released model promises only: these are not
// microphone/provider tests and make no claim about real transcription accuracy.
function speech(ms = 6_000) {
  const buffer = Buffer.alloc(ms * 32);
  for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(8_000, i);
  return buffer;
}

async function settle() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function backends(): LiveBackends {
  const pass1 = new MockGeminiPass1Backend();
  let count = 0;
  return {
    backend: 'mock',
    pass1: {
      run: vi.fn(async (input) => {
        const result = await pass1.run(input);
        const text = `fictional spoken segment ${++count}`;
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
    reasoning: { run: vi.fn((input) => new MockGeminiReasoningBackend().run(input)) },
    therapyReasoning: { run: vi.fn((input) => new MockGeminiTherapyReasoningBackend().run(input)) },
  };
}

const sessions: LiveSession[] = [];
function setup(b = backends(), patientContext?: PatientContext) {
  const events: LiveGatewayEvent[] = [];
  const session = new LiveSession(
    'fictional-scribe-analysis',
    null,
    b,
    (event) => {
      LiveGatewayEventSchema.parse(event);
      events.push(event);
    },
    undefined,
    patientContext,
  );
  sessions.push(session);
  session.start();
  return { session, events, b };
}

async function window(session: LiveSession) {
  session.pushAudio(speech());
  let transcribed = false;
  void session.pump().then(() => {
    transcribed = true;
  });
  await settle();
  // Explicitly fail, rather than hanging behind a deferred analysis promise,
  // if a regression makes the audio pump own note/reasoning work again.
  expect(transcribed).toBe(true);
}

function transcripts(events: LiveGatewayEvent[]) {
  return events.flatMap((event) => (event.type === 'utterance' ? [event.utterance.text] : []));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Scribe transcription stays independent of ordered background analysis', () => {
  it('emits later windows once and in order while reasoning is held, coalescing pending source', async () => {
    vi.stubEnv('LIVE_REASONING_MIN_GAP_MS', '0');
    const b = backends();
    const gate = deferred();
    const inner = b.reasoning.run;
    let calls = 0;
    b.reasoning.run = vi.fn(async (input) => {
      if (++calls === 1) await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    await window(session);
    await window(session);

    expect(transcripts(events)).toEqual([
      'fictional spoken segment 1',
      'fictional spoken segment 2',
      'fictional spoken segment 3',
    ]);
    expect(b.reasoning.run).toHaveBeenCalledTimes(1);
    expect(b.pass2.run).not.toHaveBeenCalled();
    gate.resolve();
    await settle();
    expect(b.reasoning.run).toHaveBeenCalledTimes(2);
    expect(vi.mocked(b.reasoning.run).mock.calls[1]![0].newUtterances.map((u) => u.text)).toEqual([
      'fictional spoken segment 2',
      'fictional spoken segment 3',
    ]);
    expect(b.pass2.run).toHaveBeenCalledTimes(1); // Existing note debounce is preserved.
    expect(b.therapyReasoning.run).not.toHaveBeenCalled();
  });

  it('keeps note source immutable and serializes reasoning plus manual refresh without blocking audio', async () => {
    vi.stubEnv('LIVE_REASONING_MIN_GAP_MS', '0');
    const b = backends();
    const gate = deferred();
    const note = b.pass2.run;
    const reasoning = b.reasoning.run;
    let first: Pass2Input | undefined;
    let active = 0;
    let maxActive = 0;
    const entered = () => {
      active++;
      maxActive = Math.max(maxActive, active);
    };
    b.reasoning.run = vi.fn(async (input) => {
      entered();
      try {
        return await reasoning(input);
      } finally {
        active--;
      }
    });
    b.pass2.run = vi.fn(async (input) => {
      entered();
      try {
        if (!first) {
          first = input;
          await gate.promise;
        }
        return await note(input);
      } finally {
        active--;
      }
    });
    const { session, events } = setup(b);
    await window(session);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    session.requestNoteRefresh();
    session.requestNoteRefresh(); // Throttled: do not queue a paid call per click.
    await window(session);
    await window(session);

    expect(transcripts(events)).toHaveLength(3);
    expect(first!.transcript).toBe('fictional spoken segment 1');
    expect(first!.speakerSegments).toHaveLength(1);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    expect(b.reasoning.run).toHaveBeenCalledTimes(1);
    gate.resolve();
    await settle();
    expect(maxActive).toBe(1);
    expect(b.reasoning.run).toHaveBeenCalledTimes(2);
    expect(b.pass2.run).toHaveBeenCalledTimes(2);
    expect(vi.mocked(b.pass2.run).mock.calls[1]![0].transcript).toBe(
      'fictional spoken segment 1 fictional spoken segment 2 fictional spoken segment 3',
    );
  });

  it('services coalesced reasoning when due during silence without repeatedly refreshing the note', async () => {
    const { session, b } = setup();
    await window(session);
    await window(session);
    expect(b.reasoning.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(b.reasoning.run).toHaveBeenCalledTimes(2);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(b.reasoning.run).toHaveBeenCalledTimes(2);
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
  });

  it('joins owned analysis, drains a short tail and uses all source in exactly one final note', async () => {
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
    session.pushAudio(speech(500));
    const finishing = session.finalize();
    await settle();
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
    gate.resolve();
    await finishing;

    expect(b.pass2Final!.run).toHaveBeenCalledTimes(1);
    const finalInput = vi.mocked(b.pass2Final!.run).mock.calls[0]![0];
    expect(finalInput.transcript).toBe(
      'fictional spoken segment 1 fictional spoken segment 2 fictional spoken segment 3',
    );
    expect(finalInput.speakerSegments).toHaveLength(3);
    expect(
      vi
        .mocked(b.reasoning.run)
        .mock.calls.at(-1)![0]
        .newUtterances.map((u) => u.text),
    ).toEqual(['fictional spoken segment 2', 'fictional spoken segment 3']);
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    const count = events.length;
    session.requestNoteRefresh();
    await session.pump();
    await session.finalize();
    await settle();
    expect(events).toHaveLength(count);
  });

  it('bounds the analysis join at End and suppresses late note output after timeout', async () => {
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    const { session, events, b } = setup();
    await window(session);
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    session.requestNoteRefresh();
    await settle();
    expect(b.pass2.run).toHaveBeenCalledTimes(1);
    await window(session);
    const finishing = session.finalize();
    await settle();
    await vi.advanceTimersByTimeAsync(5_001);
    await finishing;

    expect(events.filter((event) => event.type === 'final')).toHaveLength(1);
    expect(events.find((event) => event.type === 'final')).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'finalization_failed',
    });
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
    const count = events.length;
    gate.resolve();
    await settle();
    expect(events).toHaveLength(count);
    expect(b.pass2Final!.run).not.toHaveBeenCalled();
  });

  it('acknowledges captured audio on pause despite slow analysis and starts no further background work', async () => {
    vi.stubEnv('LIVE_REASONING_MIN_GAP_MS', '0');
    const b = backends();
    const gate = deferred();
    const inner = b.reasoning.run;
    b.reasoning.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    session.pushAudio(speech(500));
    let paused = false;
    void session.pause('00000000-0000-4000-8000-000000000001').then(() => {
      paused = true;
    });
    await settle();
    expect(paused).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'capturePaused' });
    expect(transcripts(events)).toHaveLength(2);
    session.pushAudio(speech());
    session.requestNoteRefresh();
    gate.resolve();
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(b.pass1.run).toHaveBeenCalledTimes(2);
    expect(b.reasoning.run).toHaveBeenCalledTimes(1);
    expect(b.pass2.run).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'final')).toBe(false);
  });

  it.each(['reasoning', 'pass2'] as const)(
    'finishes within the deadline without fabricating a note when initial %s never completes',
    async (stage) => {
      vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
      const b = backends();
      const gate = deferred();
      if (stage === 'reasoning') {
        const inner = b.reasoning.run;
        b.reasoning.run = vi.fn(async (input) => {
          await gate.promise;
          return inner(input);
        });
      } else {
        const inner = b.pass2.run;
        b.pass2.run = vi.fn(async (input) => {
          await gate.promise;
          return inner(input);
        });
      }
      const { session, events } = setup(b);
      await window(session);
      const finishing = session.finalize();
      await settle();
      await vi.advanceTimersByTimeAsync(5_001);
      await finishing;
      expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
      expect(events.some((event) => event.type === 'final' || event.type === 'note')).toBe(false);
      const count = events.length;
      gate.resolve();
      await settle();
      expect(events).toHaveLength(count);
      expect(b.pass2Final!.run).not.toHaveBeenCalled();
    },
  );

  it.each(['reasoning', 'pass2'] as const)(
    'disposal invalidates held %s output and discards queued analysis',
    async (stage) => {
      const b = backends();
      const gate = deferred();
      if (stage === 'reasoning') {
        const inner = b.reasoning.run;
        b.reasoning.run = vi.fn(async (input) => {
          await gate.promise;
          return inner(input);
        });
      } else {
        const inner = b.pass2.run;
        b.pass2.run = vi.fn(async (input) => {
          await gate.promise;
          return inner(input);
        });
      }
      const { session, events } = setup(b);
      await window(session);
      await window(session);
      session.requestNoteRefresh();
      session.dispose();
      const count = events.length;
      gate.resolve();
      await settle();
      expect(events).toHaveLength(count);
      expect(b.reasoning.run).toHaveBeenCalledTimes(1);
      expect(b.pass2.run).toHaveBeenCalledTimes(stage === 'reasoning' ? 0 : 1);
      expect(b.pass2Final!.run).not.toHaveBeenCalled();
    },
  );

  it('recovers from reasoning and note failures without wedging future transcription or refresh', async () => {
    vi.stubEnv('LIVE_REASONING_MIN_GAP_MS', '0');
    const { session, events, b } = setup();
    vi.mocked(b.reasoning.run).mockRejectedValueOnce(new Error('fictional reasoning failure'));
    vi.mocked(b.pass2.run).mockRejectedValueOnce(new Error('fictional note failure'));
    await window(session);
    await window(session);
    expect(transcripts(events)).toHaveLength(2);
    expect(b.reasoning.run).toHaveBeenCalledTimes(2);
    expect(b.pass2.run).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === 'note')).toBe(true);
    session.requestNoteRefresh();
    await settle();
    expect(b.pass2.run).toHaveBeenCalledTimes(3);
  });

  it('enforces analysis spend limits even when no further speech arrives', async () => {
    vi.stubEnv('LIVE_COST_CEILING_INR', '1');
    const b = backends();
    // Exercise paid-call accounting with direct synthetic implementations;
    // the mock wire contract intentionally rejects any nonzero spend.
    b.backend = 'vertex';
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      const result = await inner(input);
      return { ...result, callLog: { ...result.callLog, costInr: 2 } };
    });
    const { session, events } = setup(b);
    await window(session);
    await settle();
    expect(events.some((event) => event.type === 'meter' && event.summary.costInr >= 2)).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    const calls = vi.mocked(b.pass2.run).mock.calls.length;
    session.requestNoteRefresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(b.pass2.run).toHaveBeenCalledTimes(calls);
  });

  it('checks newly drafted drug interactions when the delayed note completes during silence', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.pass2.run;
    b.pass2.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b, {
      sex: 'unknown',
      knownConditions: [],
      allergies: [],
      activeMeds: ['Warfarin 5mg'],
    });
    await window(session);
    expect(
      events.some((event) => event.type === 'gap' && event.gap.kind === 'DRUG_INTERACTION'),
    ).toBe(false);
    gate.resolve();
    await settle();
    expect(
      events.some(
        (event) =>
          event.type === 'gap' &&
          event.gap.kind === 'DRUG_INTERACTION' &&
          /warfarin/i.test(event.gap.message),
      ),
    ).toBe(true);
    expect(b.pass1.run).toHaveBeenCalledTimes(1);
  });

  it('skips another interim call when reasoning itself reaches the spend ceiling', async () => {
    vi.stubEnv('LIVE_COST_CEILING_INR', '1');
    const b = backends();
    b.backend = 'vertex'; // Direct synthetic implementations; no provider requests.
    const inner = b.reasoning.run;
    b.reasoning.run = vi.fn(async (input) => {
      const result = await inner(input);
      return { ...result, callLog: { ...result.callLog, costInr: 2 } };
    });
    const { session, events } = setup(b);
    await window(session);
    await vi.advanceTimersByTimeAsync(25);
    await settle();
    expect(b.pass2.run).not.toHaveBeenCalled();
    expect(b.pass2Final!.run).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: 'status', state: 'done' });
    expect(events.some((event) => event.type === 'meter' && event.summary.costInr >= 2)).toBe(true);
  });

  it('rejects findings citing speech that arrived after the reasoning request started', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.reasoning.run;
    b.reasoning.run = vi.fn(async (input) => {
      await gate.promise;
      const result = await inner(input);
      return {
        ...result,
        output: {
          ...result.output,
          findings: [
            {
              id: 'fictional-valid-citation',
              kind: 'symptom' as const,
              label: 'fictional existing source',
              polarity: 'present' as const,
              utteranceIds: [input.newUtterances[0]!.id],
            },
            {
              id: 'fictional-future-citation',
              kind: 'symptom' as const,
              label: 'fictional unobserved source',
              polarity: 'present' as const,
              utteranceIds: ['u2'],
            },
          ],
        },
      };
    });
    const { session, events } = setup(b);
    await window(session);
    await window(session);
    expect(events.some((event) => event.type === 'utterance' && event.utterance.id === 'u2')).toBe(
      true,
    );
    gate.resolve();
    await settle();
    const findings = events.flatMap((event) => (event.type === 'finding' ? event.findings : []));
    expect(findings.some((finding) => finding.id === 'fictional-valid-citation')).toBe(true);
    expect(findings.some((finding) => finding.id === 'fictional-future-citation')).toBe(false);
  });

  it('discards held reasoning across an optional clinical authority revoke and regrant', async () => {
    const b = backends();
    const gate = deferred();
    const inner = b.reasoning.run;
    b.reasoning.run = vi.fn(async (input) => {
      await gate.promise;
      return inner(input);
    });
    const { session, events } = setup(b);
    await window(session);
    const withoutAnalysis = new Set<PractitionerCapability>([
      'LIVE_ENCOUNTER',
      'MEDICAL_DOCUMENTATION',
      'PRESCRIPTION_DRAFTING',
      'CLINICAL_ORDERS',
      'CHRONIC_CARE',
    ]);
    session.updateCapabilities(withoutAnalysis);
    session.updateCapabilities(new Set([...withoutAnalysis, 'CLINICAL_ANALYSIS']));
    const count = events.filter(
      (event) => event.type === 'finding' || event.type === 'reasoning',
    ).length;
    gate.resolve();
    await settle();
    expect(
      events.filter((event) => event.type === 'finding' || event.type === 'reasoning'),
    ).toHaveLength(count);
    expect(b.pass2.run).toHaveBeenCalledTimes(1); // Documentation remains authorized.
  });
});
