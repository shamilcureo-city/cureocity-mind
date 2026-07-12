import { NextResponse, type NextRequest } from 'next/server';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { writeAudit } from '@/lib/audit';
import { runCareReport } from '@/lib/care-report';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Abandonment margin beyond the longest session cap. */
const ABANDON_AFTER_MIN = Math.max(...Object.values(CARE_SESSION_CAP_MIN)) + 15;

/**
 * GET /api/v1/cron/care-session-sweeper (AC3, §4.6) — finalize sessions
 * whose client went dark mid-session (network death, closed tab): mark
 * ABORTED and, when any transcript was mirrored, still run Pass 10 so
 * the report degrades gracefully instead of vanishing. Also expires
 * CREATED rows that were never redeemed.
 *
 * Auth mirrors the other cron routes: x-vercel-cron OR CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - ABANDON_AFTER_MIN * 60 * 1000);
  const stale = await prisma.careSession.findMany({
    where: {
      status: { in: ['CREATED', 'IN_PROGRESS'] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    },
    select: { id: true, status: true, startedAt: true, liveTranscript: true },
    take: 50,
  });

  let aborted = 0;
  let reported = 0;
  for (const s of stale) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.careSession.update({
        where: { id: s.id },
        data: {
          status: 'ABORTED',
          endedAt: now,
          durationSec: s.startedAt ? Math.round((now.getTime() - s.startedAt.getTime()) / 1000) : 0,
        },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_SESSION_ABORTED',
          targetType: 'CareSession',
          targetId: s.id,
          metadata: { cause: 'SWEEPER_ABANDONED', previousStatus: s.status },
        },
        tx,
      );
    });
    aborted += 1;
    const hasTurns = Array.isArray(s.liveTranscript) && s.liveTranscript.length > 0;
    if (hasTurns) {
      const result = await runCareReport(s.id);
      if (result.ok) reported += 1;
    }
  }

  return NextResponse.json({ swept: stale.length, aborted, reported });
}

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env['CRON_SECRET'];
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}
