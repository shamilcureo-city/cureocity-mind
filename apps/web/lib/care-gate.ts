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

export const CARE_TIER_WEEKLY_CAP: Record<string, number> = {
  free: 2,
  plus: 7,
};

export interface CareGateInput {
  status: 'ACTIVE' | 'SAFETY_HOLD' | 'DELETED';
  onboardedAt: Date | null;
  planTier: string;
  /** COMPLETED or IN_PROGRESS sessions in the trailing 7 days. */
  sessionsThisWeek: number;
}

export type CareGateCode = 'OK' | 'NOT_ONBOARDED' | 'SAFETY_HOLD' | 'WEEKLY_CAP' | 'DELETED';

export interface CareGateVerdict {
  allowed: boolean;
  code: CareGateCode;
  /** Plain words, shown verbatim on the home card. */
  reason?: string;
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
  const cap = CARE_TIER_WEEKLY_CAP[input.planTier] ?? CARE_TIER_WEEKLY_CAP['free']!;
  if (input.sessionsThisWeek >= cap) {
    return {
      allowed: false,
      code: 'WEEKLY_CAP',
      reason: `You've done your ${cap} session${cap === 1 ? '' : 's'} this week — see you next week. Your plan and homework are below.`,
    };
  }
  return { allowed: true, code: 'OK' };
}
