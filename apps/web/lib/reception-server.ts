import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

export class ReceptionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ReceptionError';
  }
}

export function requireReceptionPilot(): void {
  if (process.env['RECEPTION_PILOT_ENABLED'] !== 'true') {
    throw new ReceptionError(503, 'Reception pilot is not enabled.');
  }
}

/** Privacy discovery is independent of rollout flags. Unknown storage state fails closed. */
export async function hasReceptionStorage(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.reception_requests') IS NOT NULL AS "exists"
  `;
  if (rows.length !== 1 || typeof rows[0]?.exists !== 'boolean') {
    throw new Error('Reception storage availability could not be verified');
  }
  return rows[0].exists;
}

export async function requireReceptionStorage(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT (
      to_regclass('public.reception_settings') IS NOT NULL
      AND to_regclass('public.reception_requests') IS NOT NULL
      AND to_regclass('public.reception_events') IS NOT NULL
      AND to_regclass('public.reception_rate_limits') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Appointment'
          AND column_name = 'suppressAutomaticMessages'
      )
    ) AS "ready"
  `;
  if (rows.length !== 1 || rows[0]?.ready !== true) {
    throw new ReceptionError(503, 'Reception pilot storage is not available.');
  }
}

export function receptionJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export function receptionFailure(error: unknown): NextResponse {
  if (error instanceof ReceptionError) return receptionJson({ error: error.message }, error.status);
  if (
    error instanceof Error &&
    (error.name === 'ClientPhiWriteForbiddenError' || error.name === 'SessionDefaultsError')
  ) {
    return receptionJson({ error: 'Active patient not found.' }, 404);
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2021' || code === 'P2022')
    return receptionJson({ error: 'Reception pilot storage is not available.' }, 503);
  if (code === 'P2002' || isReceptionTransactionConflict(error))
    return receptionJson({ error: 'This request changed. Refresh and try again.' }, 409);
  // Never echo database diagnostics, contact values or request narratives to logs or callers.
  return receptionJson({ error: 'Reception is temporarily unavailable. Try again shortly.' }, 503);
}

/** Prisma may wrap PostgreSQL serialization/deadlock codes in meta or cause. */
export function isReceptionTransactionConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false;
  const record = error as Record<string, unknown>;
  return (
    ['P2034', '40001', '40P01'].includes(String(record.code)) ||
    isReceptionTransactionConflict(record.meta, depth + 1) ||
    isReceptionTransactionConflict(record.cause, depth + 1)
  );
}

/** Public forms require affirmative same-origin evidence, even without cookies. */
export function requirePublicReceptionOrigin(req: Request): void {
  const site = req.headers.get('sec-fetch-site');
  if ((site && site !== 'same-origin') || req.headers.get('origin') !== new URL(req.url).origin) {
    throw new ReceptionError(403, 'Cross-site mutation blocked.');
  }
}

/** Bound actual streamed bytes; Content-Length alone does not bound a chunked body. */
export async function readReceptionInput<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ReceptionError(415, 'Use a JSON request.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new ReceptionError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 32_768) {
      await reader.cancel();
      throw new ReceptionError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ReceptionError(400, 'Invalid JSON request.');
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success)
    throw new ReceptionError(400, parsed.error.issues[0]?.message ?? 'Invalid request.');
  return parsed.data;
}
