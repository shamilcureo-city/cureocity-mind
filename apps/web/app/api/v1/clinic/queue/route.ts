import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { loadClinicQueue } from '@/lib/clinic-queue';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS7 — GET /api/v1/clinic/queue
 *
 * The doctor's OPD queue for today (IST clinic day): every session
 * scheduled today, ordered by token, with a derived queue status and a
 * pointer to the next WAITING patient. This is the data behind the
 * zero-click clinic landing page (`/app/clinic`) and the turnover
 * auto-advance. Doctor-vertical only, tenant-scoped to the caller.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const me = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { vertical: true },
  });
  if (me?.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'The clinic queue is for the doctor vertical only.' },
      { status: 409 },
    );
  }

  const queue = await loadClinicQueue(auth.value.psychologistId);
  return NextResponse.json(queue);
}
