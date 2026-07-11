import { describe, expect, it } from 'vitest';
import {
  AcceptCarePlanInputSchema,
  CareInstrumentInputSchema,
  CareLiveServerEventSchema,
  CareOnboardingInputSchema,
  CareReportV1Schema,
  MirrorTurnsInputSchema,
  RedeemLiveTokenResponseSchema,
} from './care';

describe('CareReportV1Schema (discriminated on kind)', () => {
  it('parses an INTAKE report and exposes assessmentAndPlan only after narrowing', () => {
    const parsed = CareReportV1Schema.parse({
      kind: 'INTAKE',
      assessmentAndPlan: {
        formulation: 'Work pressure and broken sleep are feeding each other.',
        concernAreas: [{ name: 'Sleep', evidenceQuote: 'I lie awake till 3' }],
        proposedGoals: [{ goal: 'Sleep before 1am', why: 'energy', measure: '5 nights/week' }],
        modalityTrack: 'CBT',
        cadence: 'weekly-25min',
        riskScreen: { level: 'NONE', evidence: [] },
      },
    });
    expect(parsed.kind).toBe('INTAKE');
    if (parsed.kind === 'INTAKE') {
      expect(parsed.assessmentAndPlan.proposedGoals).toHaveLength(1);
    }
  });

  it('parses a TREATMENT report with defensive fallbacks on malformed leaves', () => {
    const parsed = CareReportV1Schema.parse({
      kind: 'TREATMENT',
      sessionReport: {
        headline: 'You caught the thought before it caught you.',
        summary: 'You challenged the hot thought with real evidence.',
        insights: 'not-an-array', // .catch([]) must absorb this
        goalProgress: [{ goalIndex: -3, movement: 'SIDEWAYS', evidence: 42 }],
        homework: { title: 'Thought record', steps: 'oops', whyItHelps: null },
        reflectionPrompt: 12345,
        riskScreen: 'garbage',
      },
    });
    if (parsed.kind !== 'TREATMENT') throw new Error('expected TREATMENT');
    expect(parsed.sessionReport.insights).toEqual([]);
    expect(parsed.sessionReport.riskScreen).toEqual({ level: 'NONE', evidence: [] });
    expect(parsed.sessionReport.reflectionPrompt).toBe('');
  });

  it('parses a REVIEW report and defaults a bad recommendation to CONTINUE', () => {
    const parsed = CareReportV1Schema.parse({
      kind: 'REVIEW',
      progressReview: {
        verdicts: [
          {
            instrumentKey: 'PHQ9',
            baselineScore: 14,
            latestScore: 8,
            verdict: 'reliable_improvement',
            plainWords: 'a drop of 5+ is real change, not noise',
          },
        ],
        goalOutcomes: [{ goalIndex: 0, status: 'ACHIEVED', note: '' }],
        revisedGoals: [],
        recommendation: 'SOMETHING_ELSE',
        narrative: 'Solid stretch of work.',
        riskScreen: { level: 'LOW', evidence: ['mentioned exhaustion'] },
      },
    });
    if (parsed.kind !== 'REVIEW') throw new Error('expected REVIEW');
    expect(parsed.progressReview.recommendation).toBe('CONTINUE');
    expect(parsed.progressReview.verdicts[0]!.verdict).toBe('reliable_improvement');
  });

  it('rejects a report with an unknown kind', () => {
    expect(() => CareReportV1Schema.parse({ kind: 'CHAT', body: {} })).toThrow();
  });
});

describe('onboarding + lifecycle inputs', () => {
  it('requires the 18+ and consent literals to be true', () => {
    const base = {
      displayName: 'Kavya',
      personaName: 'Meera',
      voiceName: 'Kore',
      hasActiveSelfHarmThoughts: false,
    };
    expect(() =>
      CareOnboardingInputSchema.parse({ ...base, isAdult: false, consentAccepted: true }),
    ).toThrow();
    expect(() =>
      CareOnboardingInputSchema.parse({ ...base, isAdult: true, consentAccepted: false }),
    ).toThrow();
    const ok = CareOnboardingInputSchema.parse({
      ...base,
      isAdult: true,
      consentAccepted: true,
    });
    expect(ok.personaStyle).toBe('gentle');
    expect(ok.preferredLanguage).toBe('en');
  });

  it('bounds a turn-mirror batch to 50 turns', () => {
    const turn = { seq: 0, role: 'user' as const, text: 'hello', atMs: 10 };
    expect(() => MirrorTurnsInputSchema.parse({ turns: [] })).toThrow();
    expect(MirrorTurnsInputSchema.parse({ turns: [turn] }).turns[0]!.role).toBe('user');
    expect(() =>
      MirrorTurnsInputSchema.parse({
        turns: Array.from({ length: 51 }, (_, i) => ({ ...turn, seq: i })),
      }),
    ).toThrow();
  });

  it('discriminates the redeemed live credential on mode', () => {
    const eph = RedeemLiveTokenResponseSchema.parse({
      mode: 'ephemeral',
      wsUrl: 'wss://example/ws',
      accessToken: 'tok',
      expiresAtMs: 1234,
    });
    expect(eph.mode).toBe('ephemeral');
    const mock = RedeemLiveTokenResponseSchema.parse({
      mode: 'mock',
      wsUrl: 'ws://localhost:8788',
      setup: { setup: {} },
      expiresAtMs: 1234,
    });
    expect(mock.mode).toBe('mock');
    expect(() => RedeemLiveTokenResponseSchema.parse({ mode: 'url', wsUrl: 'wss://x' })).toThrow();
  });

  it('accepts a plan with 1-6 goals only', () => {
    const goal = { goal: 'Sleep before 1am', why: '', measure: '' };
    const input = {
      sourceSessionId: 'ckvp8p0000000000000000000',
      modalityTrack: 'CBT' as const,
      goals: [goal],
    };
    expect(AcceptCarePlanInputSchema.parse(input).cadence).toBe('weekly-25min');
    expect(() => AcceptCarePlanInputSchema.parse({ ...input, goals: [] })).toThrow();
    expect(() =>
      AcceptCarePlanInputSchema.parse({ ...input, goals: Array(7).fill(goal) }),
    ).toThrow();
  });

  it('validates instrument submissions against the known keys', () => {
    expect(() =>
      CareInstrumentInputSchema.parse({ instrumentKey: 'WHODAS', answers: {} }),
    ).toThrow();
    const ok = CareInstrumentInputSchema.parse({
      instrumentKey: 'PHQ9',
      answers: { phq9_1: 2, phq9_9: 0 },
    });
    expect(ok.answers['phq9_1']).toBe(2);
  });
});

describe('CareLiveServerEventSchema (wire subset)', () => {
  it('parses the recipe-shaped snake_case transcription events', () => {
    const ev = CareLiveServerEventSchema.parse({
      serverContent: { input_transcription: { text: 'hello there', finished: true } },
    });
    expect('serverContent' in ev).toBe(true);
  });

  it('parses setupComplete and toolCall frames', () => {
    expect(() => CareLiveServerEventSchema.parse({ setupComplete: {} })).not.toThrow();
    const tool = CareLiveServerEventSchema.parse({
      toolCall: { functionCalls: [{ name: 'flag_crisis', args: { severity: 'HIGH' } }] },
    });
    expect('toolCall' in tool).toBe(true);
  });
});
