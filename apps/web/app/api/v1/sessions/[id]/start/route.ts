import type { NextRequest, NextResponse } from 'next/server';
import { POST as startEncounter } from '../../../encounters/[id]/start/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface RouteContext {
  params: Promise<{ id: string }>;
}

/** @deprecated Use POST /api/v1/encounters/:id/start. */
export function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return startEncounter(req, ctx);
}
