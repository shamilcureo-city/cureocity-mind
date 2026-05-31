import { NextResponse, type NextRequest } from 'next/server';
import type { NextSessionSummary } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/next-session — next SCHEDULED session or null. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const row = await prisma.session.findFirst({
    where: { clientId: auth.value.clientId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
    orderBy: { scheduledAt: 'asc' },
    include: { psychologist: { select: { fullName: true } } },
  });
  if (!row) return NextResponse.json(null);
  const body: NextSessionSummary = {
    sessionId: row.id,
    scheduledAt: row.scheduledAt.toISOString(),
    modality: row.modality,
    psychologistFullName: row.psychologist.fullName,
  };
  return NextResponse.json(body);
}
