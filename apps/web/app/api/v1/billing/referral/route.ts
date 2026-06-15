import { NextResponse, type NextRequest } from 'next/server';
import type { ReferralStatus } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import {
  REFERRED_FREE_DAYS,
  REFERRER_REWARD_DAYS,
  ensureReferralCode,
} from '@/lib/referral';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/billing/referral — Sprint 56 (Lever 3b). The caller's
 * referral code (created lazily) + how it's performing, for the Plan
 * page "refer a peer" card.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psychologistId = auth.value.psychologistId;

  const code = await ensureReferralCode(psychologistId);
  const [referredCount, rewardedCount] = await Promise.all([
    prisma.referralRedemption.count({ where: { referrerPsychologistId: psychologistId } }),
    prisma.referralRedemption.count({
      where: { referrerPsychologistId: psychologistId, rewardGrantedAt: { not: null } },
    }),
  ]);

  const body: ReferralStatus = {
    code,
    referredCount,
    rewardedCount,
    referredFreeDays: REFERRED_FREE_DAYS,
    referrerRewardDays: REFERRER_REWARD_DAYS,
  };
  return NextResponse.json(body);
}
