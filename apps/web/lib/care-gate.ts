/**
 * Cureocity Care — the session gate (AC2, §2 layers 5-6 + tier caps).
 * Pure function; used by BOTH the home route (display, with a human-
 * readable reason) and the session-create route (enforcement). Keeping
 * display and enforcement on one function is what stops them drifting.
 *
 * Native-audio Live minutes are the COGS — the tier caps here ARE the
 * unit economics. Pricing decision #3 tunes the numbers; the mechanism
 * does not change.
 */

/**
 * Per-tier weekly session caps. Defaults are the product numbers (free: 2,
 * plus: 7); each is overridable via env (`CARE_WEEKLY_CAP_FREE` /
 * `CARE_WEEKLY_CAP_PLUS`) so a pilot/testing deploy can raise them WITHOUT
 * changing the shipped default — set a high value in Vercel to test freely,
 * unset to restore the product cap. A non-positive / unparseable value falls
 * back to the default.
 */
function weeklyCapFromEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const CARE_TIER_WEEKLY_CAP: Record<string, number> = {
  free: weeklyCapFromEnv('CARE_WEEKLY_CAP_FREE', 2),
  // CG3 — Plus is 4/week, NOT daily (clinical-ethics ruling: selling daily
  // AI therapy monetizes the dependency loop; the heaviest users are
  // statistically the sickest). Double the free cadence, sold as
  // flexibility for heavy weeks.
  plus: weeklyCapFromEnv('CARE_WEEKLY_CAP_PLUS', 4),
};

/**
 * CG3 — the EFFECTIVE tier. Plus is a prepaid 30-day pass (no auto-renewal):
 * `planExpiresAt` in the future (or null — an operator grant with no expiry)
 * keeps 'plus'; past it, the account silently returns to 'free'. Computed,
 * never written back — display and enforcement stay on one pure path.
 */
export function effectiveCareTier(
  planTier: string,
  planExpiresAt: Date | null | undefined,
  now: Date = new Date(),
  /// CG5 — the 7-day no-card trial: computed-plus while unexpired.
  trialEndsAt?: Date | null,
): string {
  if (trialEndsAt && trialEndsAt.getTime() > now.getTime()) return 'plus';
  if (planTier !== 'plus') return planTier;
  if (planExpiresAt && planExpiresAt.getTime() <= now.getTime()) return 'free';
  return 'plus';
}

export interface CareGateInput {
  status: 'ACTIVE' | 'SAFETY_HOLD' | 'DELETED';
  onboardedAt: Date | null;
  planTier: string;
  /** Plus pass expiry (CG3) — see effectiveCareTier. */
  planExpiresAt?: Date | null;
  /** Trial expiry (CG5) — see effectiveCareTier. */
  trialEndsAt?: Date | null;
  /** Unconsumed, unexpired session-pack credits (CG5). */
  availableCredits?: number;
  /** COMPLETED or IN_PROGRESS sessions in the trailing 7 days. */
  sessionsThisWeek: number;
  /**
   * createdAt of the OLDEST session inside the trailing-7-day window —
   * lets the capped state name the concrete unlock day instead of a
   * dead-end string (CG3, the graceful cap).
   */
  oldestWeekSessionAt?: Date | null;
  now?: Date;
}

export type CareGateCode = 'OK' | 'NOT_ONBOARDED' | 'SAFETY_HOLD' | 'WEEKLY_CAP' | 'DELETED';

export interface CareGateVerdict {
  allowed: boolean;
  code: CareGateCode;
  /** Plain words, shown verbatim on the home card. */
  reason?: string;
  /** WEEKLY_CAP only — when the oldest in-window session ages out. */
  nextUnlockAt?: Date;
  /** CG5 — this start rides a session-pack credit (the create route consumes one). */
  usingCredit?: boolean;
}

export function evaluateCareGate(input: CareGateInput): CareGateVerdict {
  if (input.status === 'DELETED') {
    return { allowed: false, code: 'DELETED', reason: 'This account has been deleted.' };
  }
  if (input.status === 'SAFETY_HOLD') {
    return {
      allowed: false,
      code: 'SAFETY_HOLD',
      reason:
        'Sessions are paused after yesterday. A quick check-in unlocks them — and help is one tap away, any time.',
    };
  }
  if (!input.onboardedAt) {
    return {
      allowed: false,
      code: 'NOT_ONBOARDED',
      reason: 'Finish setting up first — choose your therapist and say hello.',
    };
  }
  const now = input.now ?? new Date();
  const tier = effectiveCareTier(input.planTier, input.planExpiresAt, now, input.trialEndsAt);
  const cap = CARE_TIER_WEEKLY_CAP[tier] ?? CARE_TIER_WEEKLY_CAP['free']!;
  if (input.sessionsThisWeek >= cap) {
    // CG5 — a session-pack credit lifts the cap for exactly one start; the
    // create route consumes it inside the same transaction. Free + pack
    // tops out at 4/week — the same ethics ceiling as Plus.
    if ((input.availableCredits ?? 0) > 0 && input.sessionsThisWeek < cap + 2) {
      return { allowed: true, code: 'OK', usingCredit: true };
    }
    const nextUnlockAt = input.oldestWeekSessionAt
      ? new Date(input.oldestWeekSessionAt.getTime() + 7 * 24 * 60 * 60 * 1000)
      : undefined;
    return {
      allowed: false,
      code: 'WEEKLY_CAP',
      // The honest generosity line — never an invented clinical norm
      // (the drafted "full weekly cadence most therapy runs at" was a
      // fabricated claim, cut by the ethics review).
      reason: `You've done your ${cap} session${cap === 1 ? '' : 's'} this week — more than most weekly therapy. Your plan and homework are below.`,
      ...(nextUnlockAt ? { nextUnlockAt } : {}),
    };
  }
  return { allowed: true, code: 'OK' };
}
