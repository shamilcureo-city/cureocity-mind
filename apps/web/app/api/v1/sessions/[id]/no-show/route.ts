import type { NextRequest, NextResponse } from 'next/server';
import { POST as markEncounterNoShow } from '../../../encounters/[id]/no-show/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface RouteContext {
  params: Promise<{ id: string }>;
}

/** @deprecated Use POST /api/v1/encounters/:id/no-show. */
export function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return markEncounterNoShow(req, ctx);
}
