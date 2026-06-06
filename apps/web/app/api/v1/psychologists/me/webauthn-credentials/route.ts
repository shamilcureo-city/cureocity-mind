import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { toWebAuthnCredential } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/psychologists/me/webauthn-credentials
 *
 * Lists the therapist's registered credentials. The presence of ≥1
 * non-revoked row makes the sign route enforce assertion-required
 * mode.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.webAuthnCredential.findMany({
    where: { psychologistId: auth.value.psychologistId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ items: rows.map(toWebAuthnCredential) });
}
