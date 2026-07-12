/**
 * Cureocity Care — session-kind inference (AC2). Pure function over
 * cumulative state, mirroring the Sprint-19 convention on the practitioner
 * side: users never pick "intake"; the server decides from the record.
 *
 *   no accepted plan            → INTAKE
 *   review due (count/worsening)→ REVIEW
 *   otherwise                   → TREATMENT
 *
 * "Review due" = the Nth completed session since the current plan version
 * was accepted (default every 6th), OR a worsening reliable-change verdict
 * (which PULLS the review forward — §2 layer 6). The worsening rule is a
 * clinician-signed threshold: do not loosen silently.
 */

export const CARE_REVIEW_EVERY_N_SESSIONS = 6;

export interface CareKindInput {
  /** Does the user have an accepted CarePlan version? */
  hasAcceptedPlan: boolean;
  /**
   * COMPLETED sessions since the current plan version was accepted
   * (any kind — a review resets the counter because accepting its plan
   * revision bumps the version; an unchanged review still counts from
   * its own completion via lastReviewCompletedSessionsAgo below).
   */
  completedSinceCurrentPlan: number;
  /**
   * COMPLETED sessions since the last REVIEW session (Infinity/undefined
   * when there has never been one).
   */
  completedSinceLastReview?: number;
  /** §2 layer 6 — a deterioration verdict on the latest instrument series. */
  worseningVerdict: boolean;
}

export type CareSessionKindVerdict = 'INTAKE' | 'TREATMENT' | 'REVIEW';

export function inferCareSessionKind(input: CareKindInput): CareSessionKindVerdict {
  if (!input.hasAcceptedPlan) return 'INTAKE';
  if (input.worseningVerdict) return 'REVIEW';
  const sinceReview = input.completedSinceLastReview ?? Number.POSITIVE_INFINITY;
  const since = Math.min(input.completedSinceCurrentPlan, sinceReview);
  if (since >= CARE_REVIEW_EVERY_N_SESSIONS - 1) return 'REVIEW';
  return 'TREATMENT';
}
