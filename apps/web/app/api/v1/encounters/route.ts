import type { NextRequest, NextResponse } from 'next/server';
import { POST as createSession } from '../sessions/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/encounters — canonical creation adapter during persistence migration. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return createSession(req);
}
