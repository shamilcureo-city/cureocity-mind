import type { RiskSeverity } from '@cureocity/contracts';
import { CBT_EXERCISE_CATALOG } from '../exercises/catalog';
import type { CbtExerciseDefinition, ExerciseRiskGate } from '../exercises/types';
import type { CbtPhase } from '../modalities/cbt/phases';

export interface AdherenceStat {
  exerciseId: string;
  /** Last time this was prescribed; null if never. */
  lastPrescribedAt: Date | null;
  /** Completion ratio over last N prescriptions, 0..1. */
  completionRate: number;
}

export interface PrescriptionEngineInput {
  currentPhase: string;
  /** Highest severity across the 3 most-recent NoteDrafts. */
  recentRiskSeverity: RiskSeverity;
  /** Adherence stats per exercise id; missing entries mean "never prescribed". */
  adherence: Map<string, AdherenceStat>;
  /** Cap recommendations. Default 5. */
  maxRecommendations?: number;
  /** Wall-clock for cadence rules (so tests can pin time). */
  now?: Date;
}

export interface ExerciseRecommendation {
  exerciseId: string;
  title: string;
  score: number;
  rationale: string[];
}

/**
 * Picks up to N CBT exercises to prescribe for a client, given:
 *   - the workflow's current phase (filters by phaseTags)
 *   - recent risk severity (suppresses via riskGate)
 *   - adherence + last-prescribed date (suppresses if too-recent for cadence)
 *
 * Scoring (informal — pilot will tune):
 *   + 5  exercise tagged for current phase
 *   + 3  outcome measure at intake/consolidation
 *   + 2  never prescribed before (fresh introduction)
 *   + 2  previously-low adherence (worth re-emphasising in session)
 *   + 1  light-weight skill exercise during early phases
 */
export function recommendCbtExercises(input: PrescriptionEngineInput): ExerciseRecommendation[] {
  const now = input.now ?? new Date();
  const max = input.maxRecommendations ?? 5;
  const phase = input.currentPhase;

  const phaseAppropriate = CBT_EXERCISE_CATALOG.filter((e) =>
    (e.phaseTags as readonly string[]).includes(phase),
  );

  const afterRiskFilter = phaseAppropriate.filter((e) =>
    isRiskGateOk(e.riskGate, input.recentRiskSeverity),
  );

  const afterCadenceFilter = afterRiskFilter.filter((e) =>
    isCadenceOk(e, input.adherence.get(e.id), now),
  );

  const scored = afterCadenceFilter.map((e) => scoreExercise(e, phase as CbtPhase, input));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, max);
}

/**
 * Risk severity ordering for gating:
 *   none < low < medium < high < critical
 */
const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isRiskGateOk(gate: ExerciseRiskGate, severity: RiskSeverity): boolean {
  const sev = SEVERITY_ORDER[severity];
  switch (gate) {
    case 'always_safe':
      return true;
    case 'medium_or_lower':
      return sev <= SEVERITY_ORDER.medium;
    case 'low_or_lower':
      return sev <= SEVERITY_ORDER.low;
  }
}

function isCadenceOk(
  exercise: CbtExerciseDefinition,
  adherence: AdherenceStat | undefined,
  now: Date,
): boolean {
  if (!adherence || !adherence.lastPrescribedAt) return true;
  const elapsedMs = now.getTime() - adherence.lastPrescribedAt.getTime();
  const DAY = 24 * 3600 * 1000;
  switch (exercise.cadence) {
    case 'one_shot':
      return false;
    case 'daily':
      return elapsedMs >= 1 * DAY;
    case 'weekly':
      return elapsedMs >= 7 * DAY;
    case 'as_needed':
      return true;
  }
}

function scoreExercise(
  exercise: CbtExerciseDefinition,
  phase: CbtPhase,
  input: PrescriptionEngineInput,
): ExerciseRecommendation {
  let score = 0;
  const rationale: string[] = [];

  if (exercise.phaseTags.includes(phase)) {
    score += 5;
    rationale.push(`tagged for ${phase}`);
  }

  if (
    exercise.category === 'outcome_measure' &&
    (phase === 'engagement_assessment' || phase === 'consolidation_relapse_prevention')
  ) {
    score += 3;
    rationale.push('outcome measure at phase boundary');
  }

  const adherence = input.adherence.get(exercise.id);
  if (!adherence || adherence.lastPrescribedAt === null) {
    score += 2;
    rationale.push('never prescribed before');
  } else if (adherence.completionRate < 0.5) {
    score += 2;
    rationale.push(`low historical adherence (${(adherence.completionRate * 100).toFixed(0)}%)`);
  }

  if (
    (exercise.category === 'skill_building' || exercise.category === 'psychoeducation') &&
    (phase === 'engagement_assessment' || phase === 'psychoeducation')
  ) {
    score += 1;
    rationale.push('foundational skill in early phase');
  }

  return {
    exerciseId: exercise.id,
    title: exercise.title,
    score,
    rationale,
  };
}

import { EMDR_EXERCISE_CATALOG } from '../exercises/emdr-catalog';
import type { EmdrPhase } from '../modalities/emdr/phases';

/**
 * EMDR equivalent of recommendCbtExercises — same scoring shape, but
 * filters the EMDR catalog and tunes the phase-boundary bonus around
 * EMDR's preparation / closure phases instead of CBT's
 * engagement / consolidation.
 *
 * Sprint 9 add — ports the CBT engine pattern to EMDR so the
 * /api/v1/workflows/[id]/prescribed-exercises route can serve EMDR
 * workflows with the same UX as CBT (was 501 before).
 */
export function recommendEmdrExercises(input: PrescriptionEngineInput): ExerciseRecommendation[] {
  const now = input.now ?? new Date();
  const max = input.maxRecommendations ?? 5;
  const phase = input.currentPhase;

  const phaseAppropriate = EMDR_EXERCISE_CATALOG.filter((e) =>
    (e.phaseTags as readonly string[]).includes(phase),
  );

  const afterRiskFilter = phaseAppropriate.filter((e) =>
    isRiskGateOk(e.riskGate, input.recentRiskSeverity),
  );

  const afterCadenceFilter = afterRiskFilter.filter((e) =>
    isCadenceOk(e, input.adherence.get(e.id), now),
  );

  const scored = afterCadenceFilter.map((e) => scoreEmdrExercise(e, phase as EmdrPhase, input));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, max);
}

function scoreEmdrExercise(
  exercise: CbtExerciseDefinition,
  phase: EmdrPhase,
  input: PrescriptionEngineInput,
): ExerciseRecommendation {
  let score = 0;
  const rationale: string[] = [];

  if (exercise.phaseTags.includes(phase as never)) {
    score += 5;
    rationale.push(`tagged for ${phase}`);
  }

  // Preparation + closure phases benefit from outcome-measure tracking
  // (analogous to CBT's engagement / consolidation bookends).
  if (exercise.category === 'outcome_measure' && (phase === 'preparation' || phase === 'closure')) {
    score += 3;
    rationale.push('outcome measure at phase boundary');
  }

  const adherence = input.adherence.get(exercise.id);
  if (!adherence || !adherence.lastPrescribedAt) {
    score += 2;
    rationale.push('never prescribed before');
  } else if (adherence.completionRate < 0.5) {
    score += 2;
    rationale.push('previously-low adherence — worth re-emphasising');
  }

  if (
    exercise.category === 'skill_building' &&
    (phase === 'preparation' || phase === 'history_taking')
  ) {
    score += 1;
    rationale.push('foundational skill in early EMDR phase');
  }

  return {
    exerciseId: exercise.id,
    title: exercise.title,
    score,
    rationale,
  };
}
