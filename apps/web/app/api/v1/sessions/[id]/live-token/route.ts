import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { signLiveToken } from '@/lib/live-token';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DV8 hardening — POST /api/v1/sessions/:id/live-token
 *
 * Mint a short-lived token the browser presents to the live gateway, so
 * the standalone socket service can prove the caller is the authenticated
 * practitioner who owns this session. Tenant-checked.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const { token, expiresInSec } = signLiveToken({
    sessionId,
    psychologistId: auth.value.psychologistId,
  });
  return NextResponse.json({ token, expiresInSec });
}
