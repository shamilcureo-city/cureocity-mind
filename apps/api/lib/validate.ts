import { NextResponse } from 'next/server';
import type { z } from 'zod';

export async function parseJson<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseQuery<T>(
  url: string,
  schema: z.ZodSchema<T>,
): { ok: true; value: T } | { ok: false; response: NextResponse } {
  const search = new URL(url).searchParams;
  const obj: Record<string, string> = {};
  for (const [k, v] of search.entries()) obj[k] = v;
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }
  return { ok: true, value: parsed.data };
}
