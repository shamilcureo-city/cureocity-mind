import { NextResponse, type NextRequest } from 'next/server';
import type { ModalityStateWithHistory } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { toModalityStateWithHistory } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/workflow — convenience lookup for the
 * single active workflow on a client (ModalityState.clientId is UNIQUE).
 * Returns 404 if the client has no workflow yet — the UI uses this as
 * the cue to surface a "Start workflow" CTA.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const row = await prisma.modalityState.findUnique({
    where: { clientId: id },
    include: { transitions: { orderBy: { occurredAt: 'asc' } } },
  });
  if (!row || row.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'No workflow for this client' }, { status: 404 });
  }

  const response: ModalityStateWithHistory = toModalityStateWithHistory(row);
  return NextResponse.json(response);
}
