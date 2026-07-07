import { z } from 'zod';

/**
 * Sprint DS2 — the live clinical reasoning snapshot (THE core).
 *
 * A ranked, evolving differential diagnosis with cited evidence for/against
 * each candidate, the "questions you haven't asked yet" that discriminate
 * between them, and the red flags that must be actively excluded. The
 * gateway's reasoning loop produces a fresh snapshot within ≤8 s of new
 * clinical information and emits it as a `reasoning` event.
 *
 * Safety (see DOCTOR_SCRIBE_V2_SPRINTS.md §0.1): every differential item and
 * red flag CITES the finding ids that justify it. The gateway drops any item
 * whose citations don't resolve to a real finding — the hallucination
 * control. Nothing here is a treatment instruction; the doctor's Rx is
 * separate. This file imports nothing from `live-encounter.ts` (the wire
 * protocol imports FROM here — one direction, no schema-eval cycle).
 */

export const DxLikelihoodSchema = z.enum(['high', 'moderate', 'low']);
export type DxLikelihood = z.infer<typeof DxLikelihoodSchema>;

/// How a candidate moved vs the previous snapshot — drives the UI's trend arrow.
export const DxTrendSchema = z.enum(['new', 'up', 'down', 'steady']);
export type DxTrend = z.infer<typeof DxTrendSchema>;

/// One ranked differential candidate. `id` is stable across updates so the
/// UI animates rank changes instead of flickering a new list.
export const LiveDifferentialItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  icd10: z.string().optional(),
  likelihood: DxLikelihoodSchema,
  trend: DxTrendSchema.default('new'),
  /** Time-critical (ACS, GI bleed, sepsis…) — the only dx that can gate. */
  urgent: z.boolean().default(false),
  /**
   * Finding ids supporting this candidate. The gateway REQUIRES ≥1 that
   * resolves to a real finding; a candidate with no surviving citation is
   * dropped (never rendered). Kept permissive here so a raw model payload
   * parses — the post-validator enforces.
   */
  evidenceFor: z.array(z.string()).default([]),
  evidenceAgainst: z.array(z.string()).default([]),
  /** What would most change this ranking (a test, a sign, an answer). */
  discriminator: z.string().optional(),
});
export type LiveDifferentialItem = z.infer<typeof LiveDifferentialItemSchema>;

// ============================================================================
// Sprint DS3 contract, defined here because the DS2 reasoning pass emits it:
// the "ask next" missing-questions stream. DS3 builds the engine (template
// source, auto-resolution, priority interleave, audit) around this shape.
// ============================================================================
export const AskNextSourceSchema = z.enum(['DIFFERENTIAL', 'TEMPLATE']);
export type AskNextSource = z.infer<typeof AskNextSourceSchema>;

export const AskNextStatusSchema = z.enum(['open', 'answered', 'dismissed', 'expired']);
export type AskNextStatus = z.infer<typeof AskNextStatusSchema>;

export const AskNextItemSchema = z.object({
  id: z.string(),
  /** Verbatim, ask-able: "Does the pain radiate to the arm or jaw?" */
  question: z.string(),
  /** Why it matters: "distinguishes ACS from GERD". */
  why: z.string(),
  /** Which differential items it discriminates (empty for TEMPLATE gaps). */
  targetDxIds: z.array(z.string()).default([]),
  source: AskNextSourceSchema.default('DIFFERENTIAL'),
  priority: z.enum(['high', 'normal']).default('normal'),
  status: AskNextStatusSchema.default('open'),
});
export type AskNextItem = z.infer<typeof AskNextItemSchema>;

/// A serious condition to actively exclude for this presentation.
export const LiveRedFlagSchema = z.object({
  label: z.string(),
  why: z.string(),
  findingIds: z.array(z.string()).default([]),
});
export type LiveRedFlag = z.infer<typeof LiveRedFlagSchema>;

/**
 * Sprint DS11.6 — a lab/test worth ordering for THIS presentation,
 * surfaced DURING the consult (adopt-only: it reaches the Rx pad's
 * investigations only via an explicit doctor tap, audited as PLAN).
 */
export const OrderNextItemSchema = z.object({
  name: z.string(),
  /** Why — one line, shown beside the adopt button. */
  rationale: z.string().optional(),
});
export type OrderNextItem = z.infer<typeof OrderNextItemSchema>;

/// The full reasoning snapshot emitted to the browser. Idempotent render —
/// the client replaces its whole reasoning view from this. `version` is
/// monotonic so superseded snapshots can be dropped.
export const LiveReasoningSchema = z.object({
  differential: z.array(LiveDifferentialItemSchema).default([]),
  askNext: z.array(AskNextItemSchema).default([]),
  redFlags: z.array(LiveRedFlagSchema).default([]),
  /** DS11.6 — physical-exam steps to consider ("Throat examination"). */
  examineNext: z.array(z.string()).default([]),
  /** DS11.6 — labs/tests to consider ordering, with rationale. */
  orderNext: z.array(OrderNextItemSchema).default([]),
  version: z.number().int().nonnegative().default(0),
});
export type LiveReasoning = z.infer<typeof LiveReasoningSchema>;
