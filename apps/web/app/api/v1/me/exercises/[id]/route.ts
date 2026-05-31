import { NextResponse, type NextRequest } from 'next/server';
import { resolveClient } from '@/lib/auth-server';
import { toExerciseAssignment } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/v1/me/exercises/:id — single fetch with ownership check. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await prisma.exerciseAssignment.findUnique({ where: { id } });
  if (!row || row.clientId !== auth.value.clientId) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  return NextResponse.json(toExerciseAssignment(row));
}
