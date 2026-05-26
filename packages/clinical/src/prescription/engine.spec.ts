import { describe, it, expect } from 'vitest';
import { isRiskGateOk, recommendCbtExercises } from './engine';

const EMPTY_ADHERENCE = new Map();

describe('isRiskGateOk', () => {
  it('always_safe accepts every severity', () => {
    expect(isRiskGateOk('always_safe', 'none')).toBe(true);
    expect(isRiskGateOk('always_safe', 'critical')).toBe(true);
  });

  it('medium_or_lower blocks high + critical', () => {
    expect(isRiskGateOk('medium_or_lower', 'medium')).toBe(true);
    expect(isRiskGateOk('medium_or_lower', 'high')).toBe(false);
    expect(isRiskGateOk('medium_or_lower', 'critical')).toBe(false);
  });

  it('low_or_lower blocks medium and above', () => {
    expect(isRiskGateOk('low_or_lower', 'low')).toBe(true);
    expect(isRiskGateOk('low_or_lower', 'medium')).toBe(false);
  });
});

describe('recommendCbtExercises', () => {
  it('returns phase-appropriate exercises only', () => {
    const recs = recommendCbtExercises({
      currentPhase: 'cognitive_restructuring',
      recentRiskSeverity: 'none',
      adherence: EMPTY_ADHERENCE,
    });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(5);
    for (const r of recs) {
      expect(r.exerciseId).toMatch(/^cbt_/);
    }
  });

  it('suppresses graded exposure when risk is medium', () => {
    const recs = recommendCbtExercises({
      currentPhase: 'behavioral_activation',
      recentRiskSeverity: 'medium',
      adherence: EMPTY_ADHERENCE,
    });
    expect(recs.find((r) => r.exerciseId === 'cbt_exposure_ladder')).toBeUndefined();
  });

  it('allows graded exposure when risk is low', () => {
    const recs = recommendCbtExercises({
      currentPhase: 'behavioral_activation',
      recentRiskSeverity: 'low',
      adherence: EMPTY_ADHERENCE,
      maxRecommendations: 20,
    });
    expect(recs.find((r) => r.exerciseId === 'cbt_exposure_ladder')).toBeDefined();
  });

  it('does NOT re-prescribe a one_shot already prescribed', () => {
    const adherence = new Map([
      [
        'cbt_cognitive_triangle_intro',
        {
          exerciseId: 'cbt_cognitive_triangle_intro',
          lastPrescribedAt: new Date(),
          completionRate: 1,
        },
      ],
    ]);
    const recs = recommendCbtExercises({
      currentPhase: 'psychoeducation',
      recentRiskSeverity: 'none',
      adherence,
      maxRecommendations: 20,
    });
    expect(recs.find((r) => r.exerciseId === 'cbt_cognitive_triangle_intro')).toBeUndefined();
  });

  it('does NOT re-prescribe a weekly cadence within 7 days', () => {
    const recentlyPrescribed = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const adherence = new Map([
      [
        'cbt_thought_record_5col',
        {
          exerciseId: 'cbt_thought_record_5col',
          lastPrescribedAt: recentlyPrescribed,
          completionRate: 0.8,
        },
      ],
    ]);
    const recs = recommendCbtExercises({
      currentPhase: 'cognitive_restructuring',
      recentRiskSeverity: 'none',
      adherence,
      maxRecommendations: 20,
    });
    expect(recs.find((r) => r.exerciseId === 'cbt_thought_record_5col')).toBeUndefined();
  });

  it('re-prescribes a weekly cadence after 8+ days', () => {
    const oldPrescribe = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const adherence = new Map([
      [
        'cbt_thought_record_5col',
        {
          exerciseId: 'cbt_thought_record_5col',
          lastPrescribedAt: oldPrescribe,
          completionRate: 0.3,
        },
      ],
    ]);
    const recs = recommendCbtExercises({
      currentPhase: 'cognitive_restructuring',
      recentRiskSeverity: 'none',
      adherence,
      maxRecommendations: 20,
    });
    const hit = recs.find((r) => r.exerciseId === 'cbt_thought_record_5col');
    expect(hit).toBeDefined();
    expect(hit!.rationale.some((s) => s.includes('low historical adherence'))).toBe(true);
  });

  it('scores outcome measures higher at engagement_assessment', () => {
    const recs = recommendCbtExercises({
      currentPhase: 'engagement_assessment',
      recentRiskSeverity: 'none',
      adherence: EMPTY_ADHERENCE,
      maxRecommendations: 5,
    });
    const phq9 = recs.find((r) => r.exerciseId === 'cbt_intake_phq9');
    const problem_list = recs.find((r) => r.exerciseId === 'cbt_problem_list');
    expect(phq9).toBeDefined();
    if (phq9 && problem_list) {
      expect(phq9.score).toBeGreaterThanOrEqual(problem_list.score);
    }
  });

  it('respects maxRecommendations cap', () => {
    const recs = recommendCbtExercises({
      currentPhase: 'cognitive_restructuring',
      recentRiskSeverity: 'none',
      adherence: EMPTY_ADHERENCE,
      maxRecommendations: 2,
    });
    expect(recs.length).toBeLessThanOrEqual(2);
  });
});
