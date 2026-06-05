import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/assignments — list a client's assignments
 * for the therapist's view. Newest-first. Optional ?status= filter
 * (single status, repeated for multi).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const statusParam = new URL(req.url).searchParams.getAll('status');
  const allowed = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'EXPIRED'] as const;
  const statuses = statusParam.filter((s): s is (typeof allowed)[number] =>
    (allowed as readonly string[]).includes(s),
  );

  const rows = await prisma.exerciseAssignment.findMany({
    where: {
      clientId,
      ...(statuses.length > 0 && { status: { in: statuses } }),
    },
    orderBy: { assignedAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ items: rows.map(toExerciseAssignment) });
}
