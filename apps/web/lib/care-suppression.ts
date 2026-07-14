/**
 * CG3 — the ONE suppression predicate (docs/CARE_GROWTH_SYSTEM.md §9,
 * invariant 2). Commerce, share, gift, and trial surfaces must all suppress
 * IDENTICALLY around vulnerability — the ethics critique found the drafted
 * per-surface predicates had drift gaps (a MODERATE-risk cap-hit user would
 * still have seen a ₹149 offer). Pure function, display + enforcement on one
 * implementation, same discipline as care-gate.ts.
 *
 * Suppress when ANY of:
 *   - the account is not ACTIVE (hold / deleted),
 *   - a safety hold or crisis event occurred within the trailing 7 days,
 *   - the latest report's risk screen is above LOW,
 *   - the latest reliable-change verdict is a deterioration,
 *   - the recent mood series is clearly declining.
 *
 * The Replika/FTC complaint (upsells timed to emotional moments) is the
 * named anti-pattern this function exists to make structurally impossible.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface CareSuppressionInput {
  status: 'ACTIVE' | 'SAFETY_HOLD' | 'DELETED';
  safetyHoldAt: Date | null;
  /** Latest CareSession.crisisAt, if any. */
  lastCrisisAt: Date | null;
  /** Latest CareReport.riskLevel, if any. */
  latestRiskLevel: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | null;
  /** Deterioration on the latest instrument series (change-score verdicts). */
  worseningVerdict: boolean;
  /** Recent mood check-in values, NEWEST FIRST. */
  recentMoods?: number[];
  now?: Date;
}

export interface CareSuppressionVerdict {
  /** True → NO commerce, shares, gifts, or trials render anywhere. */
  suppress: boolean;
  reasons: string[];
}

/** Newest-first mood series: declining = last 3 average at least 1.5 below the prior 3. */
export function isMoodDeclining(recentMoods: number[]): boolean {
  if (recentMoods.length < 6) return false;
  const recent = recentMoods.slice(0, 3);
  const prior = recentMoods.slice(3, 6);
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return avg(recent) <= avg(prior) - 1.5;
}

export function evaluateCareSuppression(input: CareSuppressionInput): CareSuppressionVerdict {
  const now = input.now ?? new Date();
  const reasons: string[] = [];

  if (input.status !== 'ACTIVE') reasons.push('account_not_active');
  if (input.safetyHoldAt && now.getTime() - input.safetyHoldAt.getTime() < SEVEN_DAYS_MS) {
    reasons.push('safety_hold_within_7d');
  }
  if (input.lastCrisisAt && now.getTime() - input.lastCrisisAt.getTime() < SEVEN_DAYS_MS) {
    reasons.push('crisis_within_7d');
  }
  if (input.latestRiskLevel === 'MODERATE' || input.latestRiskLevel === 'HIGH') {
    reasons.push('risk_screen_above_low');
  }
  if (input.worseningVerdict) reasons.push('worsening_verdict');
  if (input.recentMoods && isMoodDeclining(input.recentMoods)) reasons.push('mood_declining');

  return { suppress: reasons.length > 0, reasons };
}
