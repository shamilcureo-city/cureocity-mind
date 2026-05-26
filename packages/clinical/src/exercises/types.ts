import { z } from 'zod';
import type { CbtPhase } from '../modalities/cbt/phases';

export const ExerciseCategorySchema = z.enum([
  'cognitive',
  'behavioral',
  'psychoeducation',
  'outcome_measure',
  'skill_building',
  'relapse_prevention',
]);
export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

export const ExerciseResponseSchemaSchema = z.enum([
  'free_text',
  'binary_completed',
  'mood_rating_0_10',
  'thought_record',
  'phq9',
  'gad7',
  'whodas2',
  'exposure_log',
]);
export type ExerciseResponseSchema = z.infer<typeof ExerciseResponseSchemaSchema>;

/**
 * Risk gating — suppress prescriptions when the most recent NoteDraft
 * risk severity exceeds the gate. e.g. 'medium_or_lower' means do NOT
 * prescribe if severity is high or critical.
 */
export const ExerciseRiskGateSchema = z.enum(['always_safe', 'medium_or_lower', 'low_or_lower']);
export type ExerciseRiskGate = z.infer<typeof ExerciseRiskGateSchema>;

export interface CbtExerciseDefinition {
  id: string;
  title: string;
  category: ExerciseCategory;
  /** Phases in which this exercise is appropriate. */
  phaseTags: readonly CbtPhase[];
  description: string;
  estimatedDurationMin: number;
  riskGate: ExerciseRiskGate;
  responseSchema: ExerciseResponseSchema;
  /**
   * Cadence (how often to re-prescribe in a phase). 'one_shot' = assign
   * once per phase; 'weekly' = assign weekly while in phase; etc.
   */
  cadence: 'one_shot' | 'weekly' | 'daily' | 'as_needed';
  /**
   * Phase-2 (Sprint 5) ships Hindi / Malayalam / Tamil / Bengali variants.
   * For V1 we only ship English canonical, so localeKeys is reserved.
   */
  localeKeys?: { hi?: string; ml?: string; ta?: string; bn?: string };
}
