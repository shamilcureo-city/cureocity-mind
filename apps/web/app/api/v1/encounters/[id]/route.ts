import { type NextRequest, type NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth-server';
import { GET as delegateSessionRoute } from '../../sessions/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCapability(req, 'LIVE_ENCOUNTER');
  if (!auth.ok) return auth.response;
  return delegateSessionRoute(req, context);
}
