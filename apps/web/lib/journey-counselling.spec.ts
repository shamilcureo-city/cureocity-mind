import { describe, expect, it, vi } from 'vitest';
import type { InstrumentChange } from '@cureocity/contracts';
vi.mock('./prisma', () => ({ prisma: {} }));
import { deriveJourneyNextBestAction, deriveJourneyStage } from './journey';

function reading(over: Partial<InstrumentChange> = {}): InstrumentChange {
  return {
    instrumentKey: 'PHQ9',
    baselineScore: 18,
    latestScore: 3,
    delta: -15,
    percentChange: -83,
    verdict: 'reliable_improvement',
    isResponse: true,
    isRemission: true,
    baselineSeverityKey: 'moderately_severe',
    latestSeverityKey: 'minimal',
    administrationCount: 2,
    baselineAt: '2026-07-01T00:00:00.000Z',
    latestAt: '2026-07-15T00:00:00.000Z',
    ...over,
  };
}
const input = {
  clientId: 'fictional-client',
  lastCompletedSessionId: 'fictional-session',
  stage: 'REVIEW_DUE' as const,
  completedCount: 3,
  hasInstruments: true,
  hasPrimaryDiagnosis: false,
  hasActivePlan: true,
  instrumentChanges: [reading()],
};

describe('legacy journey respects counselling and clinician-led endings', () => {
  it('improvement is review due, not discharge ready', () => {
    expect(
      deriveJourneyStage({
        completedCount: 3,
        hasActivePlan: true,
        sessionsSincePlan: 2,
        progressReviewDue: true,
      }),
    ).toBe('REVIEW_DUE');
    const action = deriveJourneyNextBestAction(input)!;
    expect(action.kind).toBe('CONTINUE');
    expect(action.title).toBe('Review progress together');
    expect(action.detail).toContain('not discharge readiness');
  });

  it('a worsened second reading outranks another measure in remission', () => {
    const action = deriveJourneyNextBestAction({
      ...input,
      instrumentChanges: [
        reading(),
        reading({
          instrumentKey: 'GAD7',
          verdict: 'deterioration',
          isRemission: false,
          isResponse: false,
        }),
      ],
    })!;
    expect(action.kind).toBe('REVIEW_PLAN_NOT_IMPROVING');
    expect(action.tone).toBe('warn');
    expect(action.detail).toContain('GAD7 shows reliable deterioration');
    expect(action.detail).toContain('even if another measure improved');
  });

  it('a stalled second measure does not yield a discharge suggestion', () => {
    const action = deriveJourneyNextBestAction({
      ...input,
      instrumentChanges: [
        reading(),
        reading({
          instrumentKey: 'GAD7',
          administrationCount: 3,
          verdict: 'no_reliable_change',
          isRemission: false,
          isResponse: false,
        }),
      ],
    })!;
    expect(action.kind).toBe('REVIEW_PLAN_NOT_IMPROVING');
  });

  it('a confirmed plan remains active without diagnosis or a baseline', () => {
    expect(
      deriveJourneyStage({
        completedCount: 2,
        hasActivePlan: true,
        sessionsSincePlan: 2,
        progressReviewDue: false,
      }),
    ).toBe('ACTIVE_TREATMENT');
    const action = deriveJourneyNextBestAction({
      ...input,
      stage: 'ACTIVE_TREATMENT',
      hasInstruments: false,
      instrumentChanges: [],
    })!;
    expect(action.detail).toContain('optional');
    expect(action.detail).toContain('does not block counselling');
  });

  it('offers shared goals and a plan without requiring a diagnosis first', () => {
    const action = deriveJourneyNextBestAction({
      ...input,
      stage: 'ASSESSMENT',
      hasActivePlan: false,
      hasInstruments: false,
      instrumentChanges: [],
    })!;
    expect(action.kind).toBe('CONFIRM_PLAN');
    expect(action.detail).toContain('A diagnosis is not required');
  });

  it('does not label missing outcome evidence as on track', () => {
    const action = deriveJourneyNextBestAction({
      ...input,
      stage: 'ACTIVE_TREATMENT',
      instrumentChanges: [],
    })!;
    expect(action.tone).toBe('info');
    expect(action.title).toBe('Check in on the agreed plan');
  });

  it('never claims discharge readiness across plan/session/review combinations', () => {
    for (const completedCount of [0, 1, 8]) {
      for (const hasActivePlan of [false, true]) {
        for (const progressReviewDue of [false, true]) {
          expect(
            deriveJourneyStage({
              completedCount,
              hasActivePlan,
              sessionsSincePlan: 8,
              progressReviewDue,
            }),
          ).not.toBe('DISCHARGE_READY');
        }
      }
    }
  });
});
