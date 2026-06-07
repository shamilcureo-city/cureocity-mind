import { z } from 'zod';
import { Icd11CodeSchema, TreatmentGoalStatusSchema } from './clinical';
import { IsoDateTimeSchema } from './common';
import { InstrumentChangeSchema } from './instrument';
import { SessionModalitySchema } from './client';

/**
 * Sprint 20 — Client therapy-journey summary (measurement-based care).
 *
 * Composed deterministically in `apps/web/lib/journey.ts` from the
 * cumulative tables (sessions, ClientDiagnosis, TreatmentPlan,
 * InstrumentResponse). Drives the Journey hub on the client detail page:
 * where the client is in their arc, whether they're measurably improving,
 * and the single next best action. No new tables in Phase 1 — everything
 * here is derived.
 */

/**
 * The arc stage, mostly derived:
 *   INTAKE           — no completed session yet
 *   ASSESSMENT       — intake done, no confirmed primary diagnosis
 *   ACTIVE_TREATMENT — an active (non-superseded) treatment plan exists
 *   REVIEW_DUE       — active plan aged ≥8 completed sessions (re-eval cadence)
 *   DISCHARGE_READY  — instrument remission reached with a plan in place
 *   DISCHARGED       — the active episode was closed (Sprint 20 Phase 3);
 *                      terminal until the client returns for a new session
 */
export const JourneyStageSchema = z.enum([
  'INTAKE',
  'ASSESSMENT',
  'ACTIVE_TREATMENT',
  'REVIEW_DUE',
  'DISCHARGE_READY',
  'DISCHARGED',
]);
export type JourneyStage = z.infer<typeof JourneyStageSchema>;

/** The kind drives the icon/colour + which deterministic rule fired. */
export const NextBestActionKindSchema = z.enum([
  'ADMINISTER_BASELINE',
  'BOOK_ASSESSMENT',
  'CONFIRM_PLAN',
  'REVIEW_PLAN_NOT_IMPROVING',
  'CONSIDER_DISCHARGE',
  'CONTINUE',
]);
export type NextBestActionKind = z.infer<typeof NextBestActionKindSchema>;

export const NextBestActionToneSchema = z.enum(['info', 'positive', 'warn']);
export type NextBestActionTone = z.infer<typeof NextBestActionToneSchema>;

export const NextBestActionSchema = z.object({
  kind: NextBestActionKindSchema,
  tone: NextBestActionToneSchema,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(600),
  /** Optional in-app destination (e.g. the client's Instruments section). */
  ctaLabel: z.string().min(1).max(60).nullable(),
  ctaHref: z.string().min(1).max(400).nullable(),
});
export type NextBestAction = z.infer<typeof NextBestActionSchema>;

export const JourneyWorkingDiagnosisSchema = z.object({
  icd11Code: Icd11CodeSchema,
  icd11Label: z.string(),
  confidence: z.number().min(0).max(1),
  confirmedAt: IsoDateTimeSchema,
});
export type JourneyWorkingDiagnosis = z.infer<typeof JourneyWorkingDiagnosisSchema>;

export const JourneyGoalSchema = z.object({
  /// Index into the active plan's goals array — drives the per-goal
  /// status toggle (PATCH /treatment-plans/:id/goals/:index).
  index: z.number().int().nonnegative(),
  description: z.string(),
  measure: z.string(),
  status: TreatmentGoalStatusSchema,
});
export type JourneyGoal = z.infer<typeof JourneyGoalSchema>;

export const JourneyActivePlanSchema = z.object({
  /// FK back to the active TreatmentPlan so the UI can PATCH goal status.
  id: z.string(),
  version: z.number().int().positive(),
  modality: SessionModalitySchema.nullable(),
  goals: z.array(JourneyGoalSchema),
  /// Convenience counts for the "X of Y achieved" readout.
  goalsAchieved: z.number().int().nonnegative(),
  goalsTotal: z.number().int().nonnegative(),
  confirmedAt: IsoDateTimeSchema,
});
export type JourneyActivePlan = z.infer<typeof JourneyActivePlanSchema>;

/** Sprint 20 Phase 3 — closed-episode summary surfaced on a discharged arc. */
export const JourneyEpisodeSchema = z.object({
  status: z.enum(['DISCHARGED', 'TRANSFERRED']),
  closedAt: IsoDateTimeSchema,
  closeReason: z.string().nullable(),
});
export type JourneyEpisode = z.infer<typeof JourneyEpisodeSchema>;

export const JourneySummarySchema = z.object({
  clientId: z.string(),
  stage: JourneyStageSchema,
  sessionsCompleted: z.number().int().nonnegative(),
  lastSessionAt: IsoDateTimeSchema.nullable(),
  workingDiagnosis: JourneyWorkingDiagnosisSchema.nullable(),
  activePlan: JourneyActivePlanSchema.nullable(),
  /** One per instrument that has ≥2 administrations. */
  instrumentChanges: z.array(InstrumentChangeSchema),
  /** The single suggested action, or null when nothing is pending. */
  nextBestAction: NextBestActionSchema.nullable(),
  /** Set when the arc is in the DISCHARGED stage (Sprint 20 Phase 3). */
  closedEpisode: JourneyEpisodeSchema.nullable(),
});
export type JourneySummary = z.infer<typeof JourneySummarySchema>;
