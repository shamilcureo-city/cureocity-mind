import { NextResponse, type NextRequest } from 'next/server';
import type { ClaimTokenPreview } from '@cureocity/contracts';
import { firstName } from '@/lib/claim-token';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/v1/claim-tokens/:token — unauthenticated preview so the
 * patient PWA can show "Pair as Riya with Dr. Sharma" before asking
 * for OTP. Only first name + therapist full name; never phone/email.
 */
export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { token } = await ctx.params;
  const row = await prisma.clientClaimToken.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          fullName: true,
          psychologist: { select: { fullName: true } },
        },
      },
    },
  });
  if (!row) return NextResponse.json({ error: 'Claim token not found' }, { status: 404 });
  if (row.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'Claim token has expired' }, { status: 400 });
  }
  const body: ClaimTokenPreview = {
    clientFirstName: firstName(row.client.fullName),
    psychologistFullName: row.client.psychologist.fullName,
    expiresAt: row.expiresAt.toISOString(),
    redeemed: row.redeemedAt !== null,
  };
  return NextResponse.json(body);
}
