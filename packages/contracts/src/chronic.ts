import { z } from 'zod';

/**
 * Sprint DV7 — chronic-disease tracking DTOs (the moat). The control /
 * trend verdicts themselves are computed by the deterministic engine in
 * `@cureocity/clinical` (chronic/index.ts); these are the wire shapes for
 * recording a reading and reading back a per-patient trajectory. See
 * docs/DOCTOR_VERTICAL.md §9, docs/DOCTOR_VERTICAL_SPRINTS.md DV7.
 */

export const ChronicMeasureKeySchema = z.enum(['BP', 'HBA1C', 'FBS', 'LDL', 'WEIGHT']);
export type ChronicMeasureKey = z.infer<typeof ChronicMeasureKeySchema>;

export const ControlStatusSchema = z.enum(['controlled', 'borderline', 'uncontrolled']);
export type ControlStatus = z.infer<typeof ControlStatusSchema>;

export const ChronicTrendSchema = z.enum(['improving', 'stable', 'worsening']);
export type ChronicTrend = z.infer<typeof ChronicTrendSchema>;

/** POST /clients/[id]/readings body — log one reading. */
export const RecordReadingInputSchema = z.object({
  measure: ChronicMeasureKeySchema,
  value: z.number().finite().positive(),
  /** BP diastolic; required when measure === 'BP'. */
  valueSecondary: z.number().finite().positive().optional(),
  /** ISO date; defaults to now server-side. */
  takenAt: z.string().datetime().optional(),
});
export type RecordReadingInput = z.infer<typeof RecordReadingInputSchema>;

export const ChronicReadingPointSchema = z.object({
  value: z.number(),
  valueSecondary: z.number().nullable().default(null),
  takenAt: z.string(),
  /** Pre-formatted for display ("150/90", "7.2"). */
  display: z.string(),
});
export type ChronicReadingPoint = z.infer<typeof ChronicReadingPointSchema>;

export const ChronicMeasureTrajectorySchema = z.object({
  measure: ChronicMeasureKeySchema,
  label: z.string(),
  unit: z.string(),
  targetText: z.string(),
  /** Oldest → newest. */
  series: z.array(ChronicReadingPointSchema),
  baseline: ChronicReadingPointSchema.nullable(),
  latest: ChronicReadingPointSchema.nullable(),
  control: ControlStatusSchema.nullable(),
  trend: ChronicTrendSchema.nullable(),
  /** Plain-language delta ("150/90 → 130/80 over 8 readings"). */
  summary: z.string().nullable(),
});
export type ChronicMeasureTrajectory = z.infer<typeof ChronicMeasureTrajectorySchema>;

export const ChronicTrajectorySchema = z.object({
  measures: z.array(ChronicMeasureTrajectorySchema),
});
export type ChronicTrajectory = z.infer<typeof ChronicTrajectorySchema>;
