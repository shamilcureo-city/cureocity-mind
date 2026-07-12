import { describe, expect, it } from 'vitest';
import { CARE_REVIEW_EVERY_N_SESSIONS, inferCareSessionKind } from './care-session-kind';

describe('inferCareSessionKind (the Sprint-19 convention: server decides)', () => {
  it('is INTAKE until a plan is accepted', () => {
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: false,
        completedSinceCurrentPlan: 0,
        worseningVerdict: false,
      }),
    ).toBe('INTAKE');
    // Even with completed sessions (an intake that never became a plan).
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: false,
        completedSinceCurrentPlan: 3,
        worseningVerdict: false,
      }),
    ).toBe('INTAKE');
  });

  it('is TREATMENT while under the review interval', () => {
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: true,
        completedSinceCurrentPlan: 1,
        worseningVerdict: false,
      }),
    ).toBe('TREATMENT');
  });

  it(`pulls a REVIEW on the ${CARE_REVIEW_EVERY_N_SESSIONS}th session`, () => {
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: true,
        completedSinceCurrentPlan: CARE_REVIEW_EVERY_N_SESSIONS - 1,
        worseningVerdict: false,
      }),
    ).toBe('REVIEW');
  });

  it('a completed review resets the counter via completedSinceLastReview', () => {
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: true,
        completedSinceCurrentPlan: 10,
        completedSinceLastReview: 1,
        worseningVerdict: false,
      }),
    ).toBe('TREATMENT');
  });

  it('a worsening reliable-change verdict pulls the review FORWARD (§2 layer 6)', () => {
    expect(
      inferCareSessionKind({
        hasAcceptedPlan: true,
        completedSinceCurrentPlan: 1,
        completedSinceLastReview: 1,
        worseningVerdict: true,
      }),
    ).toBe('REVIEW');
  });
});
