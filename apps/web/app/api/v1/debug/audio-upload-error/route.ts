import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/debug/audio-upload-error — receives a brief error report
 * from the browser when @vercel/blob/client.upload() throws after the
 * handshake. Surfaces the error name + message into Vercel runtime logs
 * so we can see what's failing on the browser side without forcing the
 * user to open devtools and copy-paste.
 *
 * Intentionally permissive: no auth, no schema validation beyond shape.
 * The payload is logged verbatim, not persisted. Drop this route once
 * the upload loop is verified end-to-end.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn('[audio-upload-error] body was not valid JSON');
    return NextResponse.json({ ok: true });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  console.error(
    `[audio-upload-error] sessionId=${b.sessionId ?? '?'} chunkIndex=${b.chunkIndex ?? '?'} stage=${b.stage ?? '?'} errorName=${b.errorName ?? '?'} errorMessage=${String(b.errorMessage ?? '').slice(0, 500)} extra=${JSON.stringify(b.extra ?? {}).slice(0, 500)}`,
  );
  return NextResponse.json({ ok: true });
}
