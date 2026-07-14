import { NextResponse, type NextRequest } from 'next/server';
import { requireCareUserId } from '@/lib/care-auth';
import { effectiveCareTier } from '@/lib/care-gate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * CG3 — GET /api/v1/care/billing/me — the tier the account is EFFECTIVELY
 * on (plus while the prepaid pass is unexpired). The plan-tier page polls
 * this after checkout; the webhook is what actually flips it.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;

  const row = await prisma.careUser.findUniqueOrThrow({
    where: { id: auth.value.careUserId },
    select: { planTier: true, planExpiresAt: true },
  });
  return NextResponse.json({
    planTier: row.planTier,
    planExpiresAt: row.planExpiresAt,
    effectiveTier: effectiveCareTier(row.planTier, row.planExpiresAt),
  });
}
