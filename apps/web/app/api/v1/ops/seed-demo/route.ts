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
 * TEMPORARY OPS TOOL — this route exists ONLY to populate a fresh pilot
 * database and should be DELETED right after. Fail-closed and gated on a
 * dedicated `DEMO_SEED_SECRET` env var the operator sets to a value of their
 * choosing (CRON_SECRET is marked Sensitive/write-only on Vercel and can't be
 * read back for a manual call, so it isn't usable here). No secret is baked
 * into the code. Writes NO audit rows and touches no real accounts.
 *
 *   Seed:  curl -X POST -H "Authorization: Bearer $DEMO_SEED_SECRET" \
 *            https://mind.cureocity.in/api/v1/ops/seed-demo
 *   Purge: add ?purge=1 to the URL.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env['DEMO_SEED_SECRET'];
  if (!secret) {
    return NextResponse.json(
      { error: 'Not configured — set the DEMO_SEED_SECRET env var and redeploy.' },
      { status: 503 },
    );
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
