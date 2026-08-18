import { type NextRequest, type NextResponse } from 'next/server';
import { requireCapability } from '@/lib/encounter-alias-auth';
import { POST as delegateSessionRoute } from '../sessions/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCapability(req);
  if (!auth.ok) return auth.response;
  return delegateSessionRoute(req);
}
