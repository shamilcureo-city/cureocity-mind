import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { seedDemo } from '@/lib/demo-seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Seeding ~48 practitioners + ~295 clients + ~780 sessions is a few hundred
// sequential upserts; give it plenty of headroom over the default.
export const maxDuration = 300;

/**
 * POST /api/v1/ops/seed-demo — one-shot demo/pilot data seed, run FROM INSIDE
 * the deployed app (where prod DB access is native — an external sandbox can't
 * reach Neon directly). It inserts the deterministic `seed-*` cohort defined in
 * `lib/demo-seed.ts` and NOTHING else; it is idempotent (re-run = no dupes).
 *
 * TEMPORARY OPS TOOL — this route exists to populate a fresh pilot database and
 * should be removed once that's done. It is fail-closed and gated on the same
 * `CRON_SECRET` used by the cron routes (which Vercel already has set on prod),
 * so it can't be triggered without that secret. It writes NO audit rows and
 * touches no real accounts.
 *
 *   Seed:  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *            https://mind.cureocity.in/api/v1/ops/seed-demo
 *   Purge: add ?purge=1 to the URL.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[ops/seed-demo] CRON_SECRET is not set — refusing (fail closed).');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const purge = new URL(req.url).searchParams.get('purge') === '1';
  try {
    const summary = await seedDemo(prisma, { purge });
    return NextResponse.json({ ok: true, purge, summary });
  } catch (e) {
    console.error('[ops/seed-demo] failed:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
