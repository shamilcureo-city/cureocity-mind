import { describe, expect, it } from 'vitest';
import type { PrepareSummaryV1 } from '@cureocity/contracts';
import { composeSessionPlan } from './session-plan';

const NOW = new Date('2026-07-31T10:00:00.000Z');

function base(): PrepareSummaryV1 {
  return {
    version: 'V1',
    clientId: 'c1',
    cachedBrief: null,
    briefGeneratedAt: null,
    briefIsStale: false,
    journey: {
      stage: 'ACTIVE_TREATMENT',
      activePlan: null,
      instrumentChanges: [],
      nextBestAction: null,
    },
    homework: [],
    openCrises: [],
    lastCompletedSessionId: null,
    lastAgreements: [],
    formulationSnapshot: null,
    carriedQuestions: [],
    confirmedDiagnoses: [],
  } as PrepareSummaryV1;
}

function withPlan(p: PrepareSummaryV1): PrepareSummaryV1 {
  return {
    ...p,
    journey: {
      ...p.journey,
      activePlan: {
        id: 'p1',
        version: 2,
        modality: 'CBT',
        goals: [
          { index: 0, description: 'Sleep 6h consistently', measure: 'diary', status: 'ACHIEVED' },
          {
            index: 1,
            description: 'Reduce meeting avoidance',
            measure: 'ladder',
            status: 'IN_PROGRESS',
          },
        ],
        goalsAchieved: 1,
        goalsTotal: 2,
        confirmedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  };
}

describe('composeSessionPlan', () => {
  it('always ends with a close step', () => {
    const plan = composeSessionPlan(base(), NOW);
    expect(plan.steps.at(-1)?.kind).toBe('close');
  });

  it('flags a brand-new client as empty rather than inventing a plan', () => {
    const plan = composeSessionPlan(base(), NOW);
    expect(plan.isEmpty).toBe(true);
    expect(plan.steps).toHaveLength(1);
  });

  it('opens with the brief’s verbatim opening line when one is cached', () => {
    const p = base();
    p.cachedBrief = {
      version: 'V1',
      language: 'en',
      contextLine: 'Session 4 of 8',
      lastSessionRecap: '',
      todaysFocus: 'Start the exposure ladder.',
      openingLine: 'How did the breathing go this week?',
      riskWatchpoints: [],
      homeworkStatus: null,
      carryoverCrisis: [],
      latestInstruments: [],
    };
    const plan = composeSessionPlan(p, NOW);
    expect(plan.steps[0]).toMatchObject({
      kind: 'open',
      detail: 'How did the breathing go this week?',
    });
  });

  it('falls back to a homework check when there is no cached brief', () => {
    const p = base();
    p.homework = [
      {
        id: 'h1',
        description: '4-7-8 breathing before bed',
        status: 'PENDING',
        assignedAt: '2026-07-24T00:00:00.000Z',
        completedAt: null,
        dueAt: null,
      },
    ];
    const plan = composeSessionPlan(p, NOW);
    expect(plan.steps[0]?.kind).toBe('open');
    expect(plan.steps[0]?.detail).toContain('4-7-8 breathing');
    expect(plan.steps[0]?.chips).toContain('Homework set last session');
  });

  it('targets the first goal that is not yet achieved', () => {
    const plan = composeSessionPlan(withPlan(base()), NOW);
    const work = plan.steps.find((s) => s.kind === 'work');
    // Goal 1 is ACHIEVED, so the plan must work on goal 2 — and number it 2,
    // not 1, so the therapist and the plan document agree.
    expect(work?.title).toBe('Work on — Goal 2: Reduce meeting avoidance');
    expect(work?.chips).toContain('1 of 2 achieved');
  });

  it('congratulates rather than inventing work when every goal is achieved', () => {
    const p = withPlan(base());
    p.journey.activePlan!.goals = p.journey.activePlan!.goals.map((g) => ({
      ...g,
      status: 'ACHIEVED' as const,
    }));
    const work = composeSessionPlan(p, NOW).steps.find((s) => s.kind === 'work');
    expect(work?.title).toContain('every goal met');
  });

  it('omits the work step entirely when there is no active plan', () => {
    const plan = composeSessionPlan(base(), NOW);
    expect(plan.steps.find((s) => s.kind === 'work')).toBeUndefined();
  });

  it('raises a measure step only once an instrument is past the re-measure window', () => {
    const p = base();
    const change = {
      instrumentKey: 'GAD7',
      baselineScore: 14,
      latestScore: 11,
      delta: -3,
      percentChange: -21,
      verdict: 'no_reliable_change',
      isResponse: false,
      isRemission: false,
      baselineSeverityKey: 'moderate',
      latestSeverityKey: 'moderate',
      administrationCount: 2,
      baselineAt: '2026-05-01T00:00:00.000Z',
      latestAt: '2026-07-25T00:00:00.000Z', // 6 days ago — not due
    } as PrepareSummaryV1['journey']['instrumentChanges'][number];
    p.journey.instrumentChanges = [change];
    expect(composeSessionPlan(p, NOW).steps.find((s) => s.kind === 'measure')).toBeUndefined();

    // 29 days ago — past the 28-day window, so it becomes due.
    p.journey.instrumentChanges = [{ ...change, latestAt: '2026-07-02T00:00:00.000Z' }];
    const due = composeSessionPlan(p, NOW).steps.find((s) => s.kind === 'measure');
    expect(due?.title).toContain('GAD7');
    expect(due?.detail).toContain('11');
  });

  it('passes carried questions through untouched, in carry order', () => {
    const p = base();
    p.carriedQuestions = [
      {
        question: 'Trauma screen',
        rationale: null,
        sourceSessionId: null,
        carriedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        question: 'Quantify drinking',
        rationale: null,
        sourceSessionId: null,
        carriedAt: '2026-07-01T00:00:00.000Z',
      },
    ];
    const plan = composeSessionPlan(p, NOW);
    expect(plan.questions.map((q) => q.question)).toEqual(['Trauma screen', 'Quantify drinking']);
  });

  it('orders the steps open → work → measure → close', () => {
    const p = withPlan(base());
    p.homework = [
      {
        id: 'h1',
        description: 'practice',
        status: 'PENDING',
        assignedAt: '2026-07-24T00:00:00.000Z',
        completedAt: null,
        dueAt: null,
      },
    ];
    p.journey.instrumentChanges = [
      {
        instrumentKey: 'PHQ9',
        baselineScore: 18,
        latestScore: 7,
        delta: -11,
        percentChange: -61,
        verdict: 'reliable_improvement',
        isResponse: true,
        isRemission: false,
        baselineSeverityKey: 'moderately_severe',
        latestSeverityKey: 'mild',
        administrationCount: 3,
        baselineAt: '2026-04-01T00:00:00.000Z',
        latestAt: '2026-06-01T00:00:00.000Z',
      } as PrepareSummaryV1['journey']['instrumentChanges'][number],
    ];
    expect(composeSessionPlan(p, NOW).steps.map((s) => s.kind)).toEqual([
      'open',
      'work',
      'measure',
      'close',
    ]);
  });
});
