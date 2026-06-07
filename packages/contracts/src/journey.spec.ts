import { describe, expect, it } from 'vitest';
import { InstrumentChangeSchema, ChangeVerdictSchema } from './instrument';
import {
  JourneyStageSchema,
  JourneySummarySchema,
  NextBestActionSchema,
  NextBestActionKindSchema,
} from './journey';

describe('ChangeVerdictSchema + InstrumentChangeSchema (Sprint 20)', () => {
  it.each(['reliable_improvement', 'no_reliable_change', 'deterioration'])(
    'accepts verdict %s',
    (v) => {
      expect(ChangeVerdictSchema.safeParse(v).success).toBe(true);
    },
  );

  it('accepts a fully-populated instrument change', () => {
    expect(
      InstrumentChangeSchema.safeParse({
        instrumentKey: 'PHQ9',
        baselineScore: 18,
        latestScore: 7,
        delta: -11,
        percentChange: -61.1,
        verdict: 'reliable_improvement',
        isResponse: true,
        isRemission: false,
        baselineSeverityKey: 'moderately_severe',
        latestSeverityKey: 'mild',
        administrationCount: 3,
        baselineAt: '2026-05-01T10:00:00.000Z',
        latestAt: '2026-06-01T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a null percentChange (baseline 0)', () => {
    expect(
      InstrumentChangeSchema.safeParse({
        instrumentKey: 'GAD7',
        baselineScore: 0,
        latestScore: 0,
        delta: 0,
        percentChange: null,
        verdict: 'no_reliable_change',
        isResponse: false,
        isRemission: true,
        baselineSeverityKey: 'minimal',
        latestSeverityKey: 'minimal',
        administrationCount: 2,
        baselineAt: '2026-05-01T10:00:00.000Z',
        latestAt: '2026-06-01T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('JourneyStageSchema (Sprint 20)', () => {
  it.each(['INTAKE', 'ASSESSMENT', 'ACTIVE_TREATMENT', 'REVIEW_DUE', 'DISCHARGE_READY'])(
    'accepts %s',
    (s) => {
      expect(JourneyStageSchema.safeParse(s).success).toBe(true);
    },
  );

  it('rejects an unknown stage', () => {
    expect(JourneyStageSchema.safeParse('TERMINATED').success).toBe(false);
  });
});

describe('NextBestActionSchema (Sprint 20)', () => {
  it.each([
    'ADMINISTER_BASELINE',
    'BOOK_ASSESSMENT',
    'CONFIRM_PLAN',
    'REVIEW_PLAN_NOT_IMPROVING',
    'CONSIDER_DISCHARGE',
    'CONTINUE',
  ])('accepts kind %s', (k) => {
    expect(NextBestActionKindSchema.safeParse(k).success).toBe(true);
  });

  it('accepts an action with a CTA', () => {
    expect(
      NextBestActionSchema.safeParse({
        kind: 'ADMINISTER_BASELINE',
        tone: 'info',
        title: 'Set a baseline',
        detail: 'Administer PHQ-9 + GAD-7 so you can track progress.',
        ctaLabel: 'Administer now',
        ctaHref: '/app/clients/abc#instruments',
      }).success,
    ).toBe(true);
  });

  it('accepts an action without a CTA (null)', () => {
    expect(
      NextBestActionSchema.safeParse({
        kind: 'CONTINUE',
        tone: 'positive',
        title: 'On track',
        detail: 'Keep going with the current plan.',
        ctaLabel: null,
        ctaHref: null,
      }).success,
    ).toBe(true);
  });
});

describe('JourneySummarySchema (Sprint 20)', () => {
  const baseline = {
    clientId: 'cabcdefghijklmnopqrstuvwx',
    stage: 'ACTIVE_TREATMENT' as const,
    sessionsCompleted: 4,
    lastSessionAt: '2026-06-01T10:00:00.000Z',
    workingDiagnosis: {
      icd11Code: '6B00',
      icd11Label: 'Generalised anxiety disorder',
      confidence: 0.7,
      confirmedAt: '2026-05-10T10:00:00.000Z',
    },
    activePlan: {
      id: 'cplan11111111111111111111',
      version: 2,
      modality: 'CBT' as const,
      goals: [
        {
          index: 0,
          description: 'Reduce panic frequency',
          measure: 'Attacks/week',
          status: 'IN_PROGRESS' as const,
        },
      ],
      goalsAchieved: 0,
      goalsTotal: 1,
      confirmedAt: '2026-05-10T10:00:00.000Z',
    },
    instrumentChanges: [],
    nextBestAction: null,
    closedEpisode: null,
  };

  it('accepts a fully-populated summary', () => {
    expect(JourneySummarySchema.safeParse(baseline).success).toBe(true);
  });

  it('accepts an intake-stage summary with nulls', () => {
    expect(
      JourneySummarySchema.safeParse({
        ...baseline,
        stage: 'INTAKE',
        sessionsCompleted: 0,
        lastSessionAt: null,
        workingDiagnosis: null,
        activePlan: null,
      }).success,
    ).toBe(true);
  });

  it('accepts a plan with a null modality (deferred intake)', () => {
    expect(
      JourneySummarySchema.safeParse({
        ...baseline,
        activePlan: { ...baseline.activePlan, modality: null },
      }).success,
    ).toBe(true);
  });
});
