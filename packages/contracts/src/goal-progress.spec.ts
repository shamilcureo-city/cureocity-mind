import { describe, expect, it } from 'vitest';
import {
  GoalProgressSchema,
  TreatmentGoalStatusSchema,
  UpdateGoalProgressInputSchema,
} from './clinical';
import { JourneyActivePlanSchema } from './journey';

describe('TreatmentGoalStatusSchema (Sprint 20 Phase 3 follow-up)', () => {
  it.each(['NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED'])('accepts %s', (s) => {
    expect(TreatmentGoalStatusSchema.safeParse(s).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(TreatmentGoalStatusSchema.safeParse('DONE').success).toBe(false);
  });
});

describe('UpdateGoalProgressInputSchema', () => {
  it('accepts a valid status payload', () => {
    expect(UpdateGoalProgressInputSchema.safeParse({ status: 'ACHIEVED' }).success).toBe(true);
  });

  it('rejects a missing status', () => {
    expect(UpdateGoalProgressInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('GoalProgressSchema', () => {
  it('accepts a row DTO', () => {
    expect(
      GoalProgressSchema.safeParse({
        treatmentPlanId: 'cplan11111111111111111111',
        goalIndex: 0,
        status: 'IN_PROGRESS',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a negative goalIndex', () => {
    expect(
      GoalProgressSchema.safeParse({
        treatmentPlanId: 'cplan11111111111111111111',
        goalIndex: -1,
        status: 'ACHIEVED',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('JourneyActivePlanSchema gains goal status + counts', () => {
  it('accepts goals with index + status + achieved counts', () => {
    expect(
      JourneyActivePlanSchema.safeParse({
        id: 'cplan11111111111111111111',
        version: 1,
        modality: 'CBT',
        goals: [
          { index: 0, description: 'Reduce panic', measure: 'Attacks/week', status: 'ACHIEVED' },
          { index: 1, description: 'Sleep', measure: 'Hours/night', status: 'NOT_STARTED' },
        ],
        goalsAchieved: 1,
        goalsTotal: 2,
        confirmedAt: '2026-05-10T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a goal missing its status', () => {
    expect(
      JourneyActivePlanSchema.safeParse({
        id: 'cplan11111111111111111111',
        version: 1,
        modality: 'CBT',
        goals: [{ index: 0, description: 'x', measure: 'y' }],
        goalsAchieved: 0,
        goalsTotal: 1,
        confirmedAt: '2026-05-10T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
