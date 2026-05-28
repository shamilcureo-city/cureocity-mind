import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/v1/sessions/:id — single read. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await fetchOwnedSession(auth.value.psychologistId, id);
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  return NextResponse.json(toSession(row));
}
