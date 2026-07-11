import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import { InstrumentKeySchema, ChangeVerdictSchema } from './instrument';
import {
  JourneyActivePlanSchema,
  JourneyEpisodeSchema,
  JourneyWorkingDiagnosisSchema,
} from './journey';

/**
 * Sprint JE1 — the Care Engine.
 *
 * One deterministic state machine that replaces the therapist Journey
 * page's stitched-together components + its TWO competing action engines
 * (the journey's single next-best-action and the case briefing's separate
 * three-item do-next, which is why "set a baseline" appeared four times).
 *
 * `computeCareEngine` (in @cureocity/clinical) is a PURE function of the
 * gathered record → a CareEngineV1. Same record, same screen. The page
 * renders five calm zones straight off this DTO:
 *
 *   arc       — the care arc + the CURRENT stage's exit gate (what earns
 *               the next stage), so the stage is visibly *earned*.
 *   queue     — ONE ranked action list (SAFETY > MEASURE > DIAGNOSE >
 *               PLAN > OUTCOME); every action says what gate it unlocks.
 *   measures  — verdict-first per instrument, with a cadence-driven due date.
 *   questions — the top few open questions by information value + how many
 *               are stale (open ≥ N sessions) vs how many gate the diagnosis.
 *   cadence   — one recommended interval + reason (no more "5d vs ~7 days").
 *
 * No LLM anywhere in this DTO. Thresholds live in one constants block in
 * the engine module.
 */

// ============================================================================
// The care arc — five earned stages + the current stage's exit gate.
// ============================================================================

export const CareStageSchema = z.enum([
  'INTAKE',
  'ASSESSMENT',
  'FORMULATION',
  'ACTIVE_TREATMENT',
  'REVIEW',
]);
export type CareStage = z.infer<typeof CareStageSchema>;

export const CareStageStatusSchema = z.enum(['done', 'current', 'upcoming']);
export type CareStageStatus = z.infer<typeof CareStageStatusSchema>;

/// One exit-gate criterion for the current stage. `met` with evidence, or
/// open with a reason + a link to the queue action that satisfies it.
export const CareGateCriterionSchema = z.object({
  key: z.string(),
  label: z.string(),
  met: z.boolean(),
  /** Shown when met: "6A70 · accepted 11 Jul". */
  evidence: z.string().nullable(),
  /** Shown when open: "high-severity flag open, no safety plan on file". */
  why: z.string().nullable(),
  /** Id of the queue action that satisfies this criterion (null = nothing to do). */
  unlocksActionId: z.string().nullable(),
});
export type CareGateCriterion = z.infer<typeof CareGateCriterionSchema>;

export const CareGateSchema = z.object({
  label: z.string(),
  metCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  criteria: z.array(CareGateCriterionSchema),
});
export type CareGate = z.infer<typeof CareGateSchema>;

export const CareStageNodeSchema = z.object({
  key: CareStageSchema,
  label: z.string(),
  status: CareStageStatusSchema,
  /** Only the CURRENT stage carries its exit gate. */
  gate: CareGateSchema.nullable(),
});
export type CareStageNode = z.infer<typeof CareStageNodeSchema>;

export const CareArcSchema = z.object({
  stage: CareStageSchema,
  stages: z.array(CareStageNodeSchema),
  sessionsCompleted: z.number().int().nonnegative(),
  lastSessionAt: IsoDateTimeSchema.nullable(),
  /** Next booked (future SCHEDULED) session, if any. */
  nextSessionAt: IsoDateTimeSchema.nullable(),
  /** Set when the episode is closed (terminal until a new session). */
  discharged: JourneyEpisodeSchema.nullable(),
  canDischarge: z.boolean(),
});
export type CareArc = z.infer<typeof CareArcSchema>;

// ============================================================================
// The action queue — one ranked list, strict priority, deduplicated.
// ============================================================================

export const CareActionPrioritySchema = z.enum([
  'SAFETY',
  'MEASURE',
  'DIAGNOSE',
  'PLAN',
  'OUTCOME',
]);
export type CareActionPriority = z.infer<typeof CareActionPrioritySchema>;

export const CareActionWhenSchema = z.enum(['this_session', 'next_session']);
export type CareActionWhen = z.infer<typeof CareActionWhenSchema>;

export const CareActionSchema = z.object({
  id: z.string(),
  priority: CareActionPrioritySchema,
  title: z.string().min(1).max(200),
  why: z.string().min(1).max(600),
  /** What this action unlocks — a gate criterion or "carried to next session". */
  unlocks: z.string().nullable(),
  when: CareActionWhenSchema,
  ctaLabel: z.string().min(1).max(60).nullable(),
  ctaHref: z.string().min(1).max(400).nullable(),
});
export type CareAction = z.infer<typeof CareActionSchema>;

// ============================================================================
// Measures — verdict-first, with a cadence-driven due state.
// ============================================================================

export const CareMeasureDueStateSchema = z.enum(['DUE_NOW', 'DUE_SOON', 'ON_TRACK']);
export type CareMeasureDueState = z.infer<typeof CareMeasureDueStateSchema>;

export const CareMeasureSchema = z.object({
  instrumentKey: InstrumentKeySchema,
  label: z.string(),
  hasBaseline: z.boolean(),
  baselineScore: z.number().int().nonnegative().nullable(),
  latestScore: z.number().int().nonnegative().nullable(),
  delta: z.number().int().nullable(),
  verdict: ChangeVerdictSchema.nullable(),
  isResponse: z.boolean(),
  isRemission: z.boolean(),
  administrationCount: z.number().int().nonnegative(),
  dueState: CareMeasureDueStateSchema,
  dueLabel: z.string(),
});
export type CareMeasure = z.infer<typeof CareMeasureSchema>;

// ============================================================================
// Questions — ranked by information value; stale + gating counts.
// ============================================================================

/// How a question narrows the case, ranked highest-value first. Mapped from
/// the AssessmentItem kind (safety > differentiate > confirm > context).
export const CareQuestionRankSchema = z.enum(['safety', 'differentiate', 'confirm', 'context']);
export type CareQuestionRank = z.infer<typeof CareQuestionRankSchema>;

export const CareRankedQuestionSchema = z.object({
  /** AssessmentItem id — closeable via PATCH .../assessment-items/[itemId]. */
  id: z.string(),
  question: z.string(),
  rationale: z.string(),
  icd11Code: z.string().nullable(),
  rank: CareQuestionRankSchema,
  /** Open for ≥ QUESTION_STALE_AT completed sessions — close it or ask it. */
  stale: z.boolean(),
});
export type CareRankedQuestion = z.infer<typeof CareRankedQuestionSchema>;

export const CareQuestionsSchema = z.object({
  /** Top few by information value (differentiators before confirmers). */
  top: z.array(CareRankedQuestionSchema),
  /** The COMPLETE ranked list (same order as `top`, which is its head) —
   *  backs the "show all N" drawer without a second query or a client re-rank. */
  all: z.array(CareRankedQuestionSchema),
  openCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  /** How many open questions currently gate the diagnosis. */
  gateCount: z.number().int().nonnegative(),
});
export type CareQuestions = z.infer<typeof CareQuestionsSchema>;

export const CareCadenceSchema = z.object({
  recommendedIntervalDays: z.number().int().positive(),
  rationale: z.string(),
  /** One human line for the header: "in ~7 days" or a booked date phrase. */
  nextSessionLabel: z.string(),
});
export type CareCadence = z.infer<typeof CareCadenceSchema>;

// ============================================================================
// CareEngineV1 — the whole page state.
// ============================================================================

export const CareEngineV1Schema = z.object({
  version: z.literal('V1'),
  clientId: z.string(),
  arc: CareArcSchema,
  /** Full ranked queue; the UI shows the top few + a "more" count. */
  queue: z.array(CareActionSchema),
  measures: z.array(CareMeasureSchema),
  questions: CareQuestionsSchema,
  cadence: CareCadenceSchema,
  workingDiagnosis: JourneyWorkingDiagnosisSchema.nullable(),
  activePlan: JourneyActivePlanSchema.nullable(),
});
export type CareEngineV1 = z.infer<typeof CareEngineV1Schema>;
