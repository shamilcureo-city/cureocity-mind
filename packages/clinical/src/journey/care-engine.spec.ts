import { describe, expect, it } from 'vitest';
import type { InstrumentChange, InstrumentKey } from '@cureocity/contracts';
import {
  CARE_ENGINE_CONSTANTS,
  computeCareEngine,
  type CareEngineInput,
  type CareEngineInstrument,
} from './care-engine';

const NOW = '2026-07-15T10:00:00.000Z';

function change(key: InstrumentKey, over: Partial<InstrumentChange> = {}): InstrumentChange {
  return {
    instrumentKey: key,
    baselineScore: 18,
    latestScore: 14,
    delta: -4,
    percentChange: -22,
    verdict: 'no_reliable_change',
    isResponse: false,
    isRemission: false,
    baselineSeverityKey: 'moderately_severe',
    latestSeverityKey: 'moderate',
    administrationCount: 2,
    baselineAt: '2026-07-01T10:00:00.000Z',
    latestAt: '2026-07-08T10:00:00.000Z',
    ...over,
  };
}

function inst(over: Partial<CareEngineInstrument> & { key: InstrumentKey }): CareEngineInstrument {
  return { count: 0, lastAt: null, change: null, ...over };
}

function makeInput(over: Partial<CareEngineInput> = {}): CareEngineInput {
  return {
    clientId: 'c1',
    now: NOW,
    sessionsCompleted: 1,
    lastSessionAt: '2026-07-14T10:00:00.000Z',
    nextSessionAt: null,
    completedSessionEndedAts: ['2026-07-14T11:00:00.000Z'],
    lastCompletedSessionId: 's1',
    workingDiagnosis: null,
    activePlan: null,
    sessionsSincePlan: 0,
    instruments: [inst({ key: 'PHQ9' }), inst({ key: 'GAD7' })],
    crisis: { highestSeverity: 'none', labels: [] },
    hasSafetyPlan: false,
    discharged: null,
    openQuestions: [],
    hrefs: { journeySub: '/j', sessionSub: '/s' },
    ...over,
  };
}

const DX = {
  icd11Code: '6A70',
  icd11Label: 'Single episode depressive disorder',
  confidence: 0.5,
  confirmedAt: '2026-07-11T10:00:00.000Z',
};

const PLAN = {
  id: 'p1',
  version: 1,
  modality: 'CBT' as const,
  goals: [{ index: 0, description: 'g', measure: 'm', status: 'NOT_STARTED' as const }],
  goalsAchieved: 0,
  goalsTotal: 1,
  confirmedAt: '2026-07-12T10:00:00.000Z',
};

describe('computeCareEngine — stages', () => {
  it('INTAKE before any completed session', () => {
    const e = computeCareEngine(makeInput({ sessionsCompleted: 0 }));
    expect(e.arc.stage).toBe('INTAKE');
    // The whole queue collapses to "record the intake".
    expect(e.queue.map((a) => a.id)).toEqual(['record-intake']);
  });

  it('ASSESSMENT until diagnosis + safety + baseline are all met', () => {
    // diagnosis accepted, but crisis open with no plan, and no baseline.
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        crisis: { highestSeverity: 'high', labels: ['suicidal ideation'] },
        hasSafetyPlan: false,
      }),
    );
    expect(e.arc.stage).toBe('ASSESSMENT');
    const gate = e.arc.stages.find((s) => s.status === 'current')!.gate!;
    expect(gate.label).toBe('To finish Assessment');
    const byKey = Object.fromEntries(gate.criteria.map((c) => [c.key, c]));
    expect(byKey['diagnosis']!.met).toBe(true);
    expect(byKey['safety']!.met).toBe(false);
    expect(byKey['baseline']!.met).toBe(false);
    expect(gate.metCount).toBe(1);
    expect(gate.totalCount).toBe(3);
  });

  it('FORMULATION when assessment is done but no plan exists', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        crisis: { highestSeverity: 'none', labels: [] },
        instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW }), inst({ key: 'GAD7' })],
        activePlan: null,
      }),
    );
    expect(e.arc.stage).toBe('FORMULATION');
    expect(e.arc.stages.find((s) => s.status === 'current')!.gate!.criteria[0]!.key).toBe('plan');
  });

  it('ACTIVE_TREATMENT with a plan and no review reached', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW }), inst({ key: 'GAD7' })],
        activePlan: PLAN,
        sessionsSincePlan: 2,
      }),
    );
    expect(e.arc.stage).toBe('ACTIVE_TREATMENT');
  });

  it('REVIEW when sessionsSincePlan crosses the review threshold', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW }), inst({ key: 'GAD7' })],
        activePlan: PLAN,
        sessionsSincePlan: CARE_ENGINE_CONSTANTS.REVIEW_AT_SESSIONS,
      }),
    );
    expect(e.arc.stage).toBe('REVIEW');
  });

  it('discharged marks every stage done and gates nothing', () => {
    const e = computeCareEngine(
      makeInput({
        discharged: { status: 'DISCHARGED', closedAt: NOW, closeReason: null },
        instruments: [inst({ key: 'PHQ9', count: 2, change: change('PHQ9') })],
      }),
    );
    expect(e.arc.stages.every((s) => s.status === 'done')).toBe(true);
    expect(e.arc.stages.every((s) => s.gate === null)).toBe(true);
    expect(e.arc.canDischarge).toBe(false);
    expect(e.queue.map((a) => a.id)).toEqual(['share-outcome']);
  });
});

describe('computeCareEngine — the action queue', () => {
  it('safety is always #1 when a crisis is open without a safety plan', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        crisis: { highestSeverity: 'high', labels: ['suicidal ideation'] },
        hasSafetyPlan: false,
      }),
    );
    expect(e.queue[0]!.id).toBe('safety-plan');
    expect(e.queue[0]!.priority).toBe('SAFETY');
  });

  it('the Rashid scenario: safety → baseline → one diagnostic question, deduplicated', () => {
    const e = computeCareEngine(
      makeInput({
        sessionsCompleted: 1,
        workingDiagnosis: DX, // accepted, but…
        crisis: { highestSeverity: 'high', labels: ['unrecognised risk'] },
        hasSafetyPlan: false,
        instruments: [inst({ key: 'PHQ9' }), inst({ key: 'GAD7' })], // no baseline
        openQuestions: [
          q('a', 'ASSESSMENT_GAP', 'Any recent stressor?', '2026-07-14T00:00:00.000Z'),
          q('b', 'DIAGNOSTIC_CRITERION', 'Duration ≥ 2 weeks?', '2026-07-14T00:00:00.000Z'),
        ],
      }),
    );
    const ids = e.queue.map((a) => a.id);
    // Exactly one safety, one measure, one diagnose — no repeats.
    expect(ids.filter((i) => i.startsWith('diagnose:')).length).toBe(1);
    expect(ids.filter((i) => i === 'baseline').length).toBe(1);
    expect(ids.filter((i) => i === 'safety-plan').length).toBe(1);
    // Order is by priority.
    expect(e.queue.map((a) => a.priority)).toEqual(['SAFETY', 'MEASURE', 'DIAGNOSE']);
    // The diagnostic question is the top-ranked one (differentiate before confirm).
    expect(e.queue[2]!.id).toBe('diagnose:a');
  });

  it('surfaces exactly ONE diagnostic question even with many open', () => {
    const e = computeCareEngine(
      makeInput({
        instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW })],
        openQuestions: Array.from({ length: 12 }, (_, i) =>
          q(`x${i}`, 'DIAGNOSTIC_CRITERION', `Q${i}`, '2026-07-14T00:00:00.000Z'),
        ),
      }),
    );
    expect(e.queue.filter((a) => a.id.startsWith('diagnose:')).length).toBe(1);
  });

  it('baseline present → PLAN confirm when a diagnosis exists but no plan', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        crisis: { highestSeverity: 'none', labels: [] },
        instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW })],
        activePlan: null,
      }),
    );
    const plan = e.queue.find((a) => a.id === 'plan-confirm');
    expect(plan).toBeDefined();
    expect(plan!.ctaHref).toBe('/s');
  });

  it('plan stalled → plan-review action', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        instruments: [
          inst({
            key: 'PHQ9',
            count: 3,
            lastAt: NOW,
            change: change('PHQ9', { administrationCount: 3, verdict: 'no_reliable_change' }),
          }),
        ],
        activePlan: PLAN,
        sessionsSincePlan: 3,
      }),
    );
    expect(e.queue.some((a) => a.id === 'plan-review')).toBe(true);
  });

  it('remission + response → discharge action', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        instruments: [
          inst({
            key: 'PHQ9',
            count: 3,
            lastAt: NOW,
            change: change('PHQ9', {
              latestScore: 3,
              verdict: 'reliable_improvement',
              isResponse: true,
              isRemission: true,
              administrationCount: 3,
            }),
          }),
        ],
        activePlan: PLAN,
        sessionsSincePlan: 4,
      }),
    );
    expect(e.arc.stage).toBe('REVIEW');
    expect(e.queue.some((a) => a.id === 'discharge')).toBe(true);
  });
});

describe('computeCareEngine — measures + cadence', () => {
  it('no administrations → DUE_NOW baseline', () => {
    const e = computeCareEngine(makeInput());
    const phq = e.measures.find((m) => m.instrumentKey === 'PHQ9')!;
    expect(phq.hasBaseline).toBe(false);
    expect(phq.dueState).toBe('DUE_NOW');
    expect(phq.dueLabel).toContain('baseline');
    expect(phq.verdict).toBeNull();
  });

  it('one administration → DUE_SOON (needs a second for a verdict)', () => {
    const e = computeCareEngine(
      makeInput({ instruments: [inst({ key: 'PHQ9', count: 1, lastAt: NOW })] }),
    );
    const phq = e.measures.find((m) => m.instrumentKey === 'PHQ9')!;
    expect(phq.hasBaseline).toBe(true);
    expect(phq.dueState).toBe('DUE_SOON');
  });

  it('active treatment + last measure > 14 days ago → DUE_NOW re-measure + a queue action', () => {
    const e = computeCareEngine(
      makeInput({
        workingDiagnosis: DX,
        instruments: [
          inst({
            key: 'PHQ9',
            count: 2,
            lastAt: '2026-06-20T10:00:00.000Z', // 25 days before NOW
            change: change('PHQ9'),
          }),
        ],
        activePlan: PLAN,
        sessionsSincePlan: 2,
      }),
    );
    const phq = e.measures.find((m) => m.instrumentKey === 'PHQ9')!;
    expect(phq.dueState).toBe('DUE_NOW');
    expect(e.queue.some((a) => a.id === 'remeasure')).toBe(true);
  });

  it('cadence is weekly during assessment', () => {
    const e = computeCareEngine(makeInput());
    expect(e.cadence.recommendedIntervalDays).toBe(7);
    expect(e.cadence.nextSessionLabel).toBe('recommend in ~7 days');
  });

  it('cadence shows the booked date when a session is scheduled', () => {
    const e = computeCareEngine(makeInput({ nextSessionAt: '2026-07-16T09:00:00.000Z' }));
    expect(e.cadence.nextSessionLabel).toBe('booked for 16 Jul');
  });
});

describe('computeCareEngine — questions', () => {
  it('ranks differentiators (ASSESSMENT_GAP) above confirmers (DIAGNOSTIC_CRITERION)', () => {
    const e = computeCareEngine(
      makeInput({
        openQuestions: [
          q('conf', 'DIAGNOSTIC_CRITERION', 'confirm one', '2026-07-14T00:00:00.000Z'),
          q('diff', 'ASSESSMENT_GAP', 'tell apart', '2026-07-14T00:00:00.000Z'),
        ],
      }),
    );
    expect(e.questions.top[0]!.id).toBe('diff');
    expect(e.questions.top[0]!.rank).toBe('differentiate');
  });

  it('flags a question stale after surviving 3 completed sessions', () => {
    const e = computeCareEngine(
      makeInput({
        completedSessionEndedAts: [
          '2026-07-14T00:00:00.000Z',
          '2026-07-10T00:00:00.000Z',
          '2026-07-05T00:00:00.000Z',
          '2026-07-02T00:00:00.000Z',
        ],
        openQuestions: [q('old', 'ASSESSMENT_GAP', 'old q', '2026-07-01T00:00:00.000Z')],
      }),
    );
    expect(e.questions.top[0]!.stale).toBe(true);
    expect(e.questions.staleCount).toBe(1);
  });

  it('gateCount counts diagnosis-narrowing questions (with or without a working dx)', () => {
    const base = {
      openQuestions: [
        q('a', 'ASSESSMENT_GAP', 'a', '2026-07-14T00:00:00.000Z'),
        q('b', 'DIAGNOSTIC_CRITERION', 'b', '2026-07-14T00:00:00.000Z'),
      ],
    };
    // A provisional working diagnosis doesn't close the gating questions —
    // they still narrow toward a settled diagnosis.
    expect(computeCareEngine(makeInput(base)).questions.gateCount).toBe(2);
    expect(
      computeCareEngine(makeInput({ ...base, workingDiagnosis: DX })).questions.gateCount,
    ).toBe(2);
  });

  it('caps the surfaced questions at TOP_QUESTIONS', () => {
    const e = computeCareEngine(
      makeInput({
        openQuestions: Array.from({ length: 9 }, (_, i) =>
          q(`x${i}`, 'ASSESSMENT_GAP', `q${i}`, '2026-07-14T00:00:00.000Z'),
        ),
      }),
    );
    expect(e.questions.top.length).toBe(CARE_ENGINE_CONSTANTS.TOP_QUESTIONS);
    expect(e.questions.openCount).toBe(9);
    // `all` carries every ranked question (the drawer source); `top` is its head.
    expect(e.questions.all.length).toBe(9);
    expect(e.questions.all.slice(0, CARE_ENGINE_CONSTANTS.TOP_QUESTIONS)).toEqual(e.questions.top);
  });
});

function q(
  id: string,
  kind: CareEngineInput['openQuestions'][number]['kind'],
  question: string,
  createdAt: string,
): CareEngineInput['openQuestions'][number] {
  return { id, kind, question, rationale: `rationale ${id}`, icd11Code: null, createdAt };
}
