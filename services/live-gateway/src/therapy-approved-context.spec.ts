import { describe, expect, it, vi } from 'vitest';
import {
  LiveGatewayCommandSchema,
  LiveGatewayEventSchema,
  TherapyReasoningModelOutputSchema,
  type LiveGatewayEvent,
  type PractitionerCapability,
  type TherapyApprovedCaseContext,
  type TherapyLiveContext,
  type Utterance,
} from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  type PassTherapyReasoningInput,
} from '@cureocity/llm';
import { LiveSession } from './live-session';
import { LiveAuthority } from './live-authority';
import { authorizeLiveSessionOutput } from './live-output-authority';

const id = 'a433f7e1-06fb-41aa-afb7-a9e19c20d85b';
const basic: PractitionerCapability[] = [
  'LIVE_ENCOUNTER',
  'BEHAVIORAL_HEALTH_DOCUMENTATION',
  'CLINICAL_ANALYSIS',
];
const all: PractitionerCapability[] = [...basic, 'MEASUREMENT_BASED_CARE', 'THERAPY_WORKFLOWS'];
const context: TherapyApprovedCaseContext = {
  version: 'V1',
  preparedAt: '2026-09-10T10:00:00.000Z',
  formulation: {
    version: 1,
    narrative:
      'Fictional reviewed formulation: work stress and avoidance may reinforce one another.',
  },
  goals: ['Participate in a work meeting'],
  diagnoses: [],
  measures: [{ instrument: 'PHQ9', score: 8, recordedAt: '2026-09-01T10:00:00.000Z' }],
  guide: {
    id: 'guide-fictional',
    updatedAt: '2026-09-01T10:00:00.000Z',
    name: 'Reviewed draft guide',
    purposes: ['Explore avoidance collaboratively'],
  },
};
const utterance: Utterance = {
  id: 'u1',
  speaker: 'patient',
  text: 'The office has been stressful.',
  tStartMs: 0,
  tEndMs: 1500,
};
function setup(
  capabilities = all,
  vertical: 'THERAPIST' | 'DOCTOR' = 'THERAPIST',
  therapyContext: TherapyLiveContext | null = null,
) {
  const events: LiveGatewayEvent[] = [];
  const mock = new MockGeminiTherapyReasoningBackend();
  const run = vi.fn((input: PassTherapyReasoningInput) => mock.run(input));
  const session = new LiveSession(
    'fictional',
    null,
    {
      backend: 'mock',
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      reasoning: new MockGeminiReasoningBackend(),
      therapyReasoning: { run },
    },
    (event) => events.push(event),
    undefined,
    undefined,
    undefined,
    vertical,
    'TREATMENT',
    'SUPPORTIVE',
    therapyContext,
    new Set(capabilities),
  );
  // Exercise the actual isolated reasoning operation without timers/audio or network.
  const reasoning = (inputUtterance = utterance) =>
    (
      session as unknown as { runTherapyReasoning(input: Utterance[]): Promise<void> }
    ).runTherapyReasoning([inputUtterance]);
  return { session, events, run, reasoning, mock };
}
describe('explicitly reviewed historical context', () => {
  it('requires an explicit gateway command and acknowledgment before supplying history to reasoning', async () => {
    const { session, events, reasoning, run } = setup();
    await reasoning();
    expect(run.mock.calls[0]?.[0].approvedCaseContext).toBeNull();
    session.reviewTherapyContext(id, context);
    expect(events).toContainEqual({
      type: 'therapyContextReviewed',
      requestId: id,
      accepted: true,
    });
    await reasoning();
    expect(run.mock.calls[1]?.[0].approvedCaseContext).toEqual(context);
    expect(run.mock.calls[1]?.[0].newUtterances).toEqual([utterance]); // history never becomes spoken evidence
    session.dispose();
  });
  it.each(['MEASUREMENT_BASED_CARE', 'THERAPY_WORKFLOWS', 'CLINICAL_ANALYSIS'] as const)(
    'rejects an unsupported snapshot when %s is absent',
    (missing) => {
      const { session, events } = setup(all.filter((capability) => capability !== missing));
      session.reviewTherapyContext(id, context);
      expect(events).toEqual([{ type: 'therapyContextReviewed', requestId: id, accepted: false }]);
      session.dispose();
    },
  );
  it('accepts basic historical formulation without inventing a need for optional measure/workflow scopes', async () => {
    const { session, run, reasoning } = setup(basic);
    session.reviewTherapyContext(id, { ...context, guide: null, measures: [] });
    await reasoning();
    expect(run.mock.calls[0]?.[0].approvedCaseContext).toMatchObject({ guide: null, measures: [] });
    session.dispose();
  });
  it.each(['MEASUREMENT_BASED_CARE', 'THERAPY_WORKFLOWS', 'CLINICAL_ANALYSIS'] as const)(
    'clears acknowledged history on revocation of %s and never silently restores it',
    async (missing) => {
      const { session, events, run, reasoning } = setup();
      session.reviewTherapyContext(id, context);
      session.updateCapabilities(new Set(all.filter((capability) => capability !== missing)));
      expect(events).toContainEqual({
        type: 'therapyContextCleared',
        reason: 'CAPABILITY_CHANGED',
      });
      session.updateCapabilities(new Set(all));
      await reasoning();
      expect(run.mock.calls[0]?.[0].approvedCaseContext).toBeNull();
      session.dispose();
    },
  );
  it('drops an in-flight result made with background that was cleared by a sub-capability downgrade', async () => {
    const { session, events, run, reasoning, mock } = setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(async (input) => {
      await pending;
      return mock.run(input);
    });
    session.reviewTherapyContext(id, context);
    const result = reasoning();
    session.updateCapabilities(new Set(basic));
    const beforeRelease = events.length;
    release();
    await result;
    expect(events.slice(beforeRelease).some((event) => event.type === 'therapyReasoning')).toBe(
      false,
    );
    session.dispose();
  });
  it('clears voluntarily with an acknowledged null snapshot and refuses doctor sessions', async () => {
    const therapist = setup();
    therapist.session.reviewTherapyContext(id, context);
    therapist.session.reviewTherapyContext(id, null);
    await therapist.reasoning();
    expect(therapist.run.mock.calls[0]?.[0].approvedCaseContext).toBeNull();
    therapist.session.dispose();
    const doctor = setup(all, 'DOCTOR');
    doctor.session.reviewTherapyContext(id, context);
    expect(doctor.events).toEqual([
      { type: 'therapyContextReviewed', requestId: id, accepted: false },
    ]);
    doctor.session.dispose();
  });
  it('allows the non-PHI clear receipt through live authority after clinical capability revocation', async () => {
    const capabilities: PractitionerCapability[] = [
      'LIVE_ENCOUNTER',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ];
    const authority = new LiveAuthority({
      sessionId: 's1',
      psychologistId: 'p1',
      vertical: 'THERAPIST',
      tokenExpiresAt: 2_000_000_000,
      requiredCapabilities: new Set(capabilities),
      verifierUrl: 'https://web.internal/api/v1/internal/live-authority',
      serviceSecret: 'fictional-secret',
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ authorized: true, capabilities }))),
      close: vi.fn(),
      updateCapabilities: vi.fn(),
    });
    const cleared = { type: 'therapyContextCleared', reason: 'CAPABILITY_CHANGED' } as const;
    await expect(authority.authorizeEvent(cleared)).resolves.toEqual(cleared);
    authority.dispose();
  });
  it('keeps wire payloads bounded and rejects arbitrary status reason text', () => {
    expect(
      LiveGatewayCommandSchema.safeParse({ type: 'reviewTherapyContext', requestId: id, context })
        .success,
    ).toBe(true);
    expect(
      LiveGatewayCommandSchema.safeParse({
        type: 'reviewTherapyContext',
        requestId: id,
        context: { ...context, goals: Array(9).fill('Too much') },
      }).success,
    ).toBe(false);
    expect(
      LiveGatewayEventSchema.safeParse({
        type: 'therapyContextCleared',
        reason: 'CAPABILITY_CHANGED',
      }).success,
    ).toBe(true);
    expect(
      LiveGatewayEventSchema.safeParse({
        type: 'therapyContextCleared',
        reason: 'Private clinical details',
      }).success,
    ).toBe(false);
  });
});

const historicalOutput = TherapyReasoningModelOutputSchema.parse({
  riskWatch: [
    {
      id: 'r1',
      label: 'Historical concern',
      why: 'Fictional reviewed background',
      severity: 'high',
      source: 'LIVE',
      sourceUtteranceIds: ['u1'],
    },
  ],
  askNext: [
    {
      id: 'a1',
      question: 'Explore the earlier PHQ9 score?',
      why: 'Fictional measure in reviewed context',
      priority: 'normal',
      status: 'open',
      source: 'LIVE',
      sourceUtteranceIds: ['u1'],
    },
  ],
  threads: [
    {
      id: 't1',
      topic: 'Earlier PHQ9 score 8',
      note: 'Fictional contextual interpretation',
      mentions: 1,
      sourceUtteranceIds: ['u1'],
    },
  ],
});

describe('reviewed-context output queue and derived prompt invalidation', () => {
  it.each(['CLINICAL_ANALYSIS', 'MEASUREMENT_BASED_CARE', 'THERAPY_WORKFLOWS'] as const)(
    'delivers the clear receipt when %s is lost and regained before the output queue drains',
    async (missing) => {
      const { session, events, reasoning, run } = setup();
      session.reviewTherapyContext(id, context);
      const oldAck = events.find((event) => event.type === 'therapyContextReviewed')!;
      session.updateCapabilities(new Set(all.filter((capability) => capability !== missing)));
      const cleared = [...events]
        .reverse()
        .find((event) => event.type === 'therapyContextCleared')!;
      session.updateCapabilities(new Set(all));
      await expect(authorizeLiveSessionOutput(cleared, null, session)).resolves.toEqual(cleared);
      await expect(authorizeLiveSessionOutput(oldAck, null, session)).resolves.toBeNull();
      await reasoning();
      expect(run.mock.calls[0]?.[0].approvedCaseContext).toBeNull();
      session.dispose();
    },
  );
  it.each(['MEASUREMENT_BASED_CARE', 'THERAPY_WORKFLOWS', 'CLINICAL_ANALYSIS'] as const)(
    'drops already queued reasoning and acknowledgment after final %s revalidation',
    async (missing) => {
      const { session, events, run, reasoning, mock } = setup();
      session.reviewTherapyContext(id, context);
      run.mockImplementationOnce(async (input) => ({
        ...(await mock.run(input)),
        output: historicalOutput,
      }));
      await reasoning();
      const queuedReasoning = [...events]
        .reverse()
        .find((event) => event.type === 'therapyReasoning')!;
      const queuedAck = events.find((event) => event.type === 'therapyContextReviewed')!;
      const current = all.filter((capability) => capability !== missing);
      const authority = new LiveAuthority({
        sessionId: 'fictional',
        psychologistId: 'owner',
        vertical: 'THERAPIST',
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
        requiredCapabilities: new Set(['LIVE_ENCOUNTER', 'BEHAVIORAL_HEALTH_DOCUMENTATION']),
        verifierUrl: 'https://web.internal/authority',
        serviceSecret: 'fictional-secret',
        fetchImpl: vi.fn(
          async () => new Response(JSON.stringify({ authorized: true, capabilities: current })),
        ),
        close: vi.fn(),
        updateCapabilities: (capabilities) => session.updateCapabilities(capabilities),
      });
      expect(
        queuedReasoning.type === 'therapyReasoning' && queuedReasoning.reasoning.threads,
      ).toHaveLength(1);
      await expect(
        authorizeLiveSessionOutput(queuedReasoning, authority, session),
      ).resolves.toBeNull();
      await expect(authorizeLiveSessionOutput(queuedAck, authority, session)).resolves.toBeNull();
      const cleared = [...events]
        .reverse()
        .find((event) => event.type === 'therapyContextCleared')!;
      await expect(authorizeLiveSessionOutput(cleared, authority, session)).resolves.toEqual(
        cleared,
      );
      if (missing !== 'CLINICAL_ANALYSIS') {
        const safe = [...events].reverse().find((event) => event.type === 'therapyReasoning')!;
        expect(safe.type === 'therapyReasoning' && safe.reasoning.threads).toEqual([]);
        await expect(authorizeLiveSessionOutput(safe, authority, session)).resolves.toEqual(safe);
      }
      authority.dispose();
      session.dispose();
    },
  );

  it.each(['replace', 'clear', 'revoke'] as const)(
    '%s removes derived prompt carryover while preserving raw utterances and deterministic safety',
    async (operation) => {
      const { session, events, run, reasoning, mock } = setup(all, 'THERAPIST', {
        carriedQuestions: [{ question: 'What matters today?', why: null }],
        priorRisk: true,
        plannedMinutes: 50,
      });
      session.reviewTherapyContext(id, context);
      run.mockImplementationOnce(async (input) => ({
        ...(await mock.run(input)),
        output: historicalOutput,
      }));
      await reasoning();
      const old = [...events].reverse().find((event) => event.type === 'therapyReasoning')!;
      if (operation === 'replace')
        session.reviewTherapyContext(id, { ...context, goals: ['A new agreed goal'] });
      else if (operation === 'clear') session.reviewTherapyContext(id, null);
      else session.updateCapabilities(new Set(basic));
      expect(session.isTherapyOutputCurrent(old)).toBe(false);
      const reset = [...events].reverse().find((event) => event.type === 'therapyReasoning');
      expect(reset?.type).toBe('therapyReasoning');
      if (reset?.type !== 'therapyReasoning') throw new Error('Expected safe reset');
      expect(reset.reasoning.threads).toEqual([]);
      expect(reset.reasoning.askNext.map((item) => item.source)).toEqual(['CARRIED']);
      expect(reset.reasoning.riskWatch.map((item) => item.source)).toEqual(['CARRIED_RISK']);
      expect(reset.reasoning.arc?.plannedMin).toBe(50);
      await reasoning({ ...utterance, id: 'u2', text: 'A different current concern.' });
      const nextInput = run.mock.calls[1]![0];
      expect(nextInput.previousThreads).toEqual([]);
      expect(nextInput.openQuestions).toEqual([]);
      expect(nextInput.recentUtterances).toContainEqual(utterance);
      expect(nextInput.carriedQuestions).toEqual([{ question: 'What matters today?', why: null }]);
      expect(nextInput.priorRisk).toBe(true);
      expect(nextInput.approvedCaseContext).toEqual(
        operation === 'replace' ? { ...context, goals: ['A new agreed goal'] } : null,
      );
      session.dispose();
    },
  );

  it('rechecks an old acknowledgment after a new review overlaps output authorization', async () => {
    const { session, events } = setup();
    session.reviewTherapyContext(id, context);
    const oldAck = events.find((event) => event.type === 'therapyContextReviewed')!;
    let release!: (event: LiveGatewayEvent) => void;
    const authorized = new Promise<LiveGatewayEvent>((resolve) => {
      release = resolve;
    });
    const pending = authorizeLiveSessionOutput(
      oldAck,
      { authorizeEvent: () => authorized },
      session,
    );
    session.reviewTherapyContext('81d3f5f8-8691-4ad8-a111-6e62dd00d7af', null);
    release(oldAck);
    await expect(pending).resolves.toBeNull();
    const newAck = [...events].reverse().find((event) => event.type === 'therapyContextReviewed')!;
    await expect(authorizeLiveSessionOutput(newAck, null, session)).resolves.toEqual(newAck);
    // The same boundary must not suppress recording/finalization control events.
    const done = { type: 'status', state: 'done' } as const;
    await expect(authorizeLiveSessionOutput(done, null, session)).resolves.toEqual(done);
    session.dispose();
  });
});
