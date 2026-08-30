import { describe, expect, it } from 'vitest';
import { buildFirstRunJourney, hasCompletedRoleplaySession } from './first-run-journey';

describe('Mind first-run journey', () => {
  it('does not count seeded historical demo sessions as a completed roleplay', () => {
    const demoCreatedAt = new Date('2026-08-30T08:00:00.000Z');

    expect(
      hasCompletedRoleplaySession(demoCreatedAt, [
        new Date('2026-06-01T08:00:00.000Z'),
        new Date('2026-07-01T08:00:00.000Z'),
      ]),
    ).toBe(false);
    expect(hasCompletedRoleplaySession(demoCreatedAt, [new Date('2026-08-30T08:05:00.000Z')])).toBe(
      true,
    );
  });

  it('turns completed roleplay into a clear next action and gives every incomplete step a CTA', () => {
    const journey = buildFirstRunJourney({
      hasExampleClient: true,
      hasRealClient: false,
      hasCompletedRoleplay: true,
      hasCompletedRealSession: false,
      hasReviewedRealNote: false,
    });

    expect(journey.choices.map((choice) => choice.label)).toEqual([
      'Try a five-minute roleplay',
      'Explore the example client',
      'Use it with a real client',
    ]);
    expect(journey.choices[0]).toMatchObject({ done: true, ctaLabel: 'Start a real session' });
    expect(
      journey.steps.filter((step) => !step.done).every((step) => step.href && step.ctaLabel),
    ).toBe(true);
  });
});
