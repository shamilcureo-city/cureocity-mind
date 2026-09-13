import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { SessionUsageCommandSchema } from '@cureocity/contracts';
import { privateJson } from '@/lib/private-response';
import { prisma } from '@/lib/prisma';
import { ClientPhiWriteForbiddenError } from '@/lib/phi-write-lock';
import { SessionUsageWriteError, writeSessionUsage } from '@/lib/session-usage-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 32_768;
function serviceAuthorized(req: Request) {
  const expected = process.env['LIVE_GATEWAY_SECRET'];
  const header = req.headers.get('authorization');
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}

/** Bound bytes before JSON parsing, including requests without Content-Length. */
async function commandBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Invalid body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('Invalid body');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return SessionUsageCommandSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export async function POST(req: NextRequest) {
  if (!serviceAuthorized(req)) return privateJson({ error: 'Unauthorized' }, { status: 401 });
  let input;
  try {
    input = await commandBody(req);
  } catch {
    return privateJson({ error: 'Invalid usage command' }, { status: 400 });
  }
  try {
    const receipt = await prisma.$transaction((tx) => writeSessionUsage(tx, input), {
      timeout: 15_000,
    });
    return privateJson(receipt);
  } catch (error) {
    const status =
      error instanceof ClientPhiWriteForbiddenError
        ? 404
        : error instanceof SessionUsageWriteError
          ? error.status
          : 503;
    // Do not emit raw DB, provider, consent or request payloads to logs or callers.
    return privateJson({ error: 'Usage receipt could not be accepted' }, { status });
  }
}
