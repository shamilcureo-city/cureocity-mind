import { NextResponse, type NextRequest } from 'next/server';
import { resolveClient } from '@/lib/auth';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me/exercises — PENDING + IN_PROGRESS assignments for
 * the logged-in client, ordered by due date.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.exerciseAssignment.findMany({
    where: { clientId: auth.value.clientId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    orderBy: [{ dueAt: 'asc' }, { assignedAt: 'asc' }],
  });
  return NextResponse.json(rows.map(toExerciseAssignment));
}
