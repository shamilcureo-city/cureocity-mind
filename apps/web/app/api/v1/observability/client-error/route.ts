import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { captureError } from '@/lib/observability-sink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/observability/client-error — Sprint 40.
 *
 * Ingests errors caught by the client error boundaries and forwards
 * them to the sink. Unauthenticated by design (an error boundary may
 * fire before/around auth), so the payload is strictly size-capped and
 * shape-validated; nothing here trusts the body beyond logging it.
 */
const ClientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  source: z.string().max(80).optional(),
  url: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = ClientErrorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const v = parsed.data;
  const err = new Error(v.message);
  if (v.stack) err.stack = v.stack;
  await captureError(err, {
    source: v.source ?? 'client',
    ...(v.digest && { digest: v.digest }),
    extra: { url: v.url },
  });
  return NextResponse.json({ ok: true });
}
