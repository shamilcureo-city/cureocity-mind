import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { llmSelfTest } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold Vertex call + model spin-up can take a few seconds.
export const maxDuration = 30;

/**
 * GET /api/v1/admin/llm-selftest — Sprint 41.
 *
 * Admin-gated Vertex connectivity check: runs one tiny real generation
 * against the configured Pro model/region and reports ok + latency, or
 * the raw error. Lets you verify the real-LLM cutover after setting
 * VERTEX_* + GCP creds, without recording a session. No-op success on
 * the mock backend.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const result = await llmSelfTest();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
