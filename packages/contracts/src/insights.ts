import { z } from 'zod';

/**
 * Sprint DS9 — pilot instrumentation ("the evidence engine").
 *
 * The read model behind `/app/insights` (screen 11) + the anonymised CSV
 * export. Every number is derived from data already persisted:
 *   - LiveConsultMetric (DS0) — consults, cost, length, throughput.
 *   - LIVE_SUGGESTION_* audit rows (DS3 / DS6) — per-card shown / acted /
 *     dismissed / auto-resolved, criticals caught, dismiss reasons.
 *   - Session rows — the activation denominator.
 * No new writes; the pilot dataset is a rollup. See
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS9.
 */

/** Why the doctor waved off an ask-next (1-tap chips, DS9). */
export const DismissReasonSchema = z.enum(['wrong', 'known', 'not_now', 'other']);
export type DismissReason = z.infer<typeof DismissReasonSchema>;

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  wrong: 'Wrong',
  known: 'Already knew',
  not_now: 'Not now',
  other: 'Other',
};

/** Per-card-type acceptance funnel. DS10-B adds PLAN (AI plan adoptions). */
export const CardTypeStatsSchema = z.object({
  kind: z.enum(['DIFFERENTIAL', 'ASK_NEXT', 'RED_FLAG', 'GAP', 'PLAN']),
  shown: z.number().int().nonnegative(),
  acted: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  autoResolved: z.number().int().nonnegative(),
  /** acted / shown (0..1); null when nothing of this kind was shown. */
  actRate: z.number().nullable(),
});
export type CardTypeStats = z.infer<typeof CardTypeStatsSchema>;

export const InsightsCatchSchema = z.object({
  label: z.string(),
  at: z.string(),
});
export type InsightsCatch = z.infer<typeof InsightsCatchSchema>;

export const DismissReasonStatSchema = z.object({
  reason: DismissReasonSchema,
  count: z.number().int().nonnegative(),
});
export type DismissReasonStat = z.infer<typeof DismissReasonStatSchema>;

/** The pre-registered pilot targets, drawn as dashboard reference lines. */
export const PilotTargetsSchema = z.object({
  /** Activation > 60% of eligible consults by week 3. */
  activation: z.number(),
  /** Rx ≤ 1-edit rate ≥ 85%. */
  rxOneEdit: z.number(),
});
export type PilotTargets = z.infer<typeof PilotTargetsSchema>;

export const PILOT_TARGETS: PilotTargets = { activation: 0.6, rxOneEdit: 0.85 };

export const DoctorInsightsSchema = z.object({
  /** ISO date bounds of the rollup window (inclusive from, exclusive to). */
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),

  /** Consults where the copilot actually ran (a metric row exists). */
  consults: z.number().int().nonnegative(),
  /** All doctor sessions in range — the activation denominator. */
  totalSessions: z.number().int().nonnegative(),
  /** consults / totalSessions (0..1); null when there were no sessions. */
  activationRate: z.number().nullable(),

  avgConsultMinutes: z.number().nullable(),
  /** Throughput — patients seen per active clinic hour. */
  tokensPerHour: z.number().nullable(),
  avgCostInr: z.number().nullable(),

  criticalsCaught: z.number().int().nonnegative(),
  cards: z.array(CardTypeStatsSchema),
  /** acted / shown for ask-next specifically; null when none shown. */
  askNextActRate: z.number().nullable(),
  dismissReasons: z.array(DismissReasonStatSchema),

  /**
   * Rx ≤ 1-edit rate — pending the signed-vs-drafted Rx diff (the DS5 sign
   * follow-up). Null until that wiring lands; the target line still renders.
   */
  rxOneEditRate: z.number().nullable(),

  /** Recent red flags the doctor acted on — "catches worth reading". */
  catches: z.array(InsightsCatchSchema),

  targets: PilotTargetsSchema,
});
export type DoctorInsights = z.infer<typeof DoctorInsightsSchema>;
