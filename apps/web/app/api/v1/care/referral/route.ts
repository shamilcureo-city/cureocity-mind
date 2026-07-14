import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireCareUserId } from '@/lib/care-auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CG6 — GET /api/v1/care/referral — the user's gift code (lazily
 * provisioned, like ensureBillingAccount) plus how many gifts have landed.
 * Generosity, not evangelism: the gift message implies the sender is
 * thoughtful, not ill.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUserId } = auth.value;

  let row = await prisma.careUser.findUniqueOrThrow({
    where: { id: careUserId },
    select: { referralCode: true },
  });
  if (!row.referralCode) {
    // Retry once on the (astronomically unlikely) code collision.
    for (let i = 0; i < 2 && !row.referralCode; i++) {
      const code = randomBytes(4).toString('hex');
      try {
        row = await prisma.careUser.update({
          where: { id: careUserId },
          data: { referralCode: code },
          select: { referralCode: true },
        });
      } catch {
        /* unique collision — loop mints a fresh code */
      }
    }
    if (!row.referralCode) {
      return NextResponse.json({ error: 'Could not mint a code' }, { status: 500 });
    }
  }

  const credited = await prisma.careReferral.count({
    where: { referrerCareUserId: careUserId, status: 'INTAKE_DONE' },
  });
  return NextResponse.json({ code: row.referralCode, giftsCredited: credited });
}
