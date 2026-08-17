import type { NextRequest, NextResponse } from 'next/server';
import { GET as getSession } from '../../sessions/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/v1/encounters/:id — canonical read adapter during persistence migration. */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return getSession(req, ctx);
}
