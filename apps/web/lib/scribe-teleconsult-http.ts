import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { ConsentAuthorizationError } from './consent-gate';
import { scribeErrorResponse, ScribeWorkspaceError } from './scribe-workspace-auth';

export function teleconsultJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
export function teleconsultError(error: unknown): NextResponse {
  const response =
    error instanceof ConsentAuthorizationError
      ? teleconsultJson(
          { error: 'Current consent could not be confirmed. Documentation remains paused.' },
          409,
        )
      : scribeErrorResponse(error);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
/** Tiny, bounded public JSON input; no token/body is echoed in validation errors. */
export async function readTeleconsultInput<T>(
  req: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const reader = req.body?.getReader();
  if (!reader) throw new ScribeWorkspaceError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new ScribeWorkspaceError(413, 'Request is too large.');
      }
      chunks.push(item.value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) throw new Error('invalid');
    return parsed.data;
  } catch (error) {
    if (error instanceof ScribeWorkspaceError) throw error;
    throw new ScribeWorkspaceError(400, 'Invalid teleconsult request.');
  } finally {
    reader.releaseLock();
  }
}
