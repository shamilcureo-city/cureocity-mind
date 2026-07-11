import { z } from 'zod';

/**
 * Sprint TS5 — the live THERAPY copilot snapshot (PASS_12_THERAPY_REASONING).
 *
 * The therapist's analogue of the doctor's live reasoning (live-reasoning.ts),
 * tuned for a psychotherapy session rather than an OPD consult. It is passive
 * and evidence-bound: nothing here speaks for the therapist, and every item
 * that makes a claim about the session CITES the utterance ids that justify
 * it. The gateway drops any item whose citations don't resolve to a real
 * seen utterance — the same hallucination control the doctor pass uses.
 *
 * Four rails:
 *   - riskWatch — safety nudges. A deterministic "re-check ideation" appears
 *     when prior suicidal ideation exists and hasn't been re-assessed today;
 *     the model may add live-detected risk cues (cited).
 *   - askNext  — "questions you planned / haven't asked". CARRIED items come
 *     from the client's carried questions (seeded by the gateway, no citation
 *     needed); LIVE items are model-generated from the session (cited).
 *   - threads  — themes the client raised that haven't been followed up
 *     (cited to where they were mentioned).
 *   - arc      — a deterministic session-pacing clock (computed in the
 *     gateway from elapsed vs planned minutes, not by the model).
 *
 * This file imports nothing from live-encounter.ts (the wire protocol imports
 * FROM here — one direction, no schema-eval cycle).
 */

export const TherapyRiskSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type TherapyRiskSeverity = z.infer<typeof TherapyRiskSeveritySchema>;

/// One safety nudge on the risk-watch rail.
export const TherapyRiskWatchItemSchema = z.object({
  id: z.string(),
  /** Short label: "Re-check ideation". */
  label: z.string().min(1).max(120),
  /** One line — why it's here. */
  why: z.string().min(1).max(400),
  severity: TherapyRiskSeveritySchema.default('medium'),
  /**
   * Whether this item is the deterministic prior-SI re-check (gateway-seeded,
   * exempt from the citation gate) vs a live model-detected cue.
   */
  source: z.enum(['CARRIED_RISK', 'LIVE']).default('LIVE'),
  /** Utterance ids that justify a LIVE item. CARRIED_RISK needs none. */
  sourceUtteranceIds: z.array(z.string()).default([]),
});
export type TherapyRiskWatchItem = z.infer<typeof TherapyRiskWatchItemSchema>;

export const TherapyAskNextSourceSchema = z.enum(['CARRIED', 'LIVE']);
export type TherapyAskNextSource = z.infer<typeof TherapyAskNextSourceSchema>;

export const TherapyAskNextStatusSchema = z.enum(['open', 'asked', 'dismissed']);
export type TherapyAskNextStatus = z.infer<typeof TherapyAskNextStatusSchema>;

/// One "ask next" nudge — a question the therapist planned (CARRIED) or the
/// model surfaced live (LIVE).
export const TherapyAskNextItemSchema = z.object({
  id: z.string(),
  question: z.string().min(1).max(500),
  why: z.string().min(1).max(400),
  source: TherapyAskNextSourceSchema.default('LIVE'),
  priority: z.enum(['high', 'normal']).default('normal'),
  status: TherapyAskNextStatusSchema.default('open'),
  /** Utterance ids for a LIVE item; CARRIED items need none. */
  sourceUtteranceIds: z.array(z.string()).default([]),
});
export type TherapyAskNextItem = z.infer<typeof TherapyAskNextItemSchema>;

/// A theme the client raised that hasn't been explored.
export const TherapyThreadItemSchema = z.object({
  id: z.string(),
  /** Short topic: "Conflict with brother". */
  topic: z.string().min(1).max(120),
  /** One line of context. */
  note: z.string().min(1).max(400),
  /** How many times it surfaced (drives "mentioned twice" copy). */
  mentions: z.number().int().positive().default(1),
  /** Utterance ids where it was mentioned. REQUIRED to survive the gate. */
  sourceUtteranceIds: z.array(z.string()).default([]),
});
export type TherapyThreadItem = z.infer<typeof TherapyThreadItemSchema>;

export const TherapyArcPhaseSchema = z.enum(['opening', 'working', 'closing', 'overrun']);
export type TherapyArcPhase = z.infer<typeof TherapyArcPhaseSchema>;

/// The deterministic session-pacing clock (gateway-computed).
export const TherapyArcSchema = z.object({
  phase: TherapyArcPhaseSchema,
  elapsedMin: z.number().int().nonnegative(),
  plannedMin: z.number().int().positive(),
  /** A pacing nudge, e.g. "Consider moving toward homework + close at ~45:00." */
  suggestion: z.string().min(1).max(300),
});
export type TherapyArc = z.infer<typeof TherapyArcSchema>;

/// The full snapshot emitted to the browser. Idempotent render — the client
/// replaces its whole copilot view from this; `version` is monotonic.
export const TherapyReasoningV1Schema = z.object({
  riskWatch: z.array(TherapyRiskWatchItemSchema).default([]),
  askNext: z.array(TherapyAskNextItemSchema).default([]),
  threads: z.array(TherapyThreadItemSchema).default([]),
  arc: TherapyArcSchema.nullable().default(null),
  version: z.number().int().nonnegative().default(0),
});
export type TherapyReasoningV1 = z.infer<typeof TherapyReasoningV1Schema>;

/// What the MODEL returns (the gateway seeds CARRIED ask-next + CARRIED_RISK +
/// the deterministic arc around this). Kept separate so the model can never
/// fabricate the carried context or the clock.
export const TherapyReasoningModelOutputSchema = z.object({
  riskWatch: z.array(TherapyRiskWatchItemSchema).default([]),
  askNext: z.array(TherapyAskNextItemSchema).default([]),
  threads: z.array(TherapyThreadItemSchema).default([]),
});
export type TherapyReasoningModelOutput = z.infer<typeof TherapyReasoningModelOutputSchema>;

/// A carried question the therapist planned, seeded into the live copilot at
/// session start (from Client.carriedQuestions).
export const TherapyCarriedQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  why: z.string().max(400).nullable().default(null),
});
export type TherapyCarriedQuestion = z.infer<typeof TherapyCarriedQuestionSchema>;

/// Therapist-specific live context passed to the gateway at connect: the
/// planned questions + whether prior suicidal ideation is on file + the
/// session's planned length. The gateway has no DB — the browser supplies it.
export const TherapyLiveContextSchema = z.object({
  carriedQuestions: z.array(TherapyCarriedQuestionSchema).max(12).default([]),
  priorRisk: z.boolean().default(false),
  plannedMinutes: z.number().int().positive().max(180).nullable().default(null),
});
export type TherapyLiveContext = z.infer<typeof TherapyLiveContextSchema>;
