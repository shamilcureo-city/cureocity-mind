import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS11.4 — GET /api/v1/live/health
 *
 * Server-side preflight for the live gateway. The Ready screen calls this
 * before a consult so a dead gateway degrades to a one-tap "Dictate
 * instead" banner rather than a dead WebSocket error mid-flow. Proxied
 * here (not fetched from the browser) so CORS and mixed-content rules
 * never distort the answer. Authenticated to avoid being an open probe.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const wsUrl = process.env['NEXT_PUBLIC_LIVE_GATEWAY_URL'] ?? 'ws://localhost:8787';
  const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');

  try {
    const res = await fetch(`${httpUrl}/healthz`, {
      signal: AbortSignal.timeout(2_500),
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: `gateway responded ${res.status}` });
    }
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      backend?: string;
      activeSessions?: number;
      maxSessions?: number;
      authRequired?: boolean;
    };
    return NextResponse.json({
      ok: body.status === 'ok',
      backend: body.backend ?? null,
      atCapacity:
        typeof body.activeSessions === 'number' &&
        typeof body.maxSessions === 'number' &&
        body.activeSessions >= body.maxSessions,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'gateway unreachable' });
  }
}
