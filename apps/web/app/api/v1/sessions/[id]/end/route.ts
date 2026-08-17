import type { NextRequest, NextResponse } from 'next/server';
import { POST as completeEncounter } from '../../../encounters/[id]/complete/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface RouteContext {
  params: Promise<{ id: string }>;
}

/** @deprecated Use POST /api/v1/encounters/:id/complete. */
export function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return completeEncounter(req, ctx);
}
