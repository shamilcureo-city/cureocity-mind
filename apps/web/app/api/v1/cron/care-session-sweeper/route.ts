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
 * PROD7 — erasure grace window. A DELETE tombstones the account (PII
 * cleared inline); after this many days the row is hard-deleted, and the
 * onDelete:Cascade relations take the transcripts / reports / plans /
 * check-ins with it. The window exists so an accidental deletion can be
 * recovered by support before the data is gone for good.
 */
const TOMBSTONE_GRACE_DAYS = 30;

/**
 * GET /api/v1/cron/care-session-sweeper (AC3, §4.6) — finalize sessions
 * whose client went dark mid-session (network death, closed tab): mark
 * ABORTED and, when any transcript was mirrored, still run Pass 10 so
 * the report degrades gracefully instead of vanishing. Also expires
 * CREATED rows that were never redeemed.
 *
 * PROD7 — additionally completes DPDP erasure: hard-deletes CareUser
 * tombstones (status DELETED) older than the grace window. Until this
 * ran, "deleted" users' full voice transcripts persisted indefinitely —
 * the settings route's cascade comment promised a sweeper that did not
 * exist.
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

  // ---- PROD7: hard-delete erasure tombstones past the grace window ----
  const graceCutoff = new Date(Date.now() - TOMBSTONE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const tombstones = await prisma.careUser.findMany({
    where: { status: 'DELETED', deletedAt: { lt: graceCutoff } },
    select: { id: true, deletedAt: true, _count: { select: { sessions: true } } },
    take: 25,
  });
  let purged = 0;
  for (const t of tombstones) {
    await prisma.$transaction(async (tx) => {
      // Cascades: sessions (→ reports), plans, check-ins, instruments.
      await tx.careUser.delete({ where: { id: t.id } });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_ACCOUNT_PURGED',
          targetType: 'CareUser',
          targetId: t.id,
          metadata: {
            deletedAt: t.deletedAt?.toISOString() ?? null,
            graceDays: TOMBSTONE_GRACE_DAYS,
            cascadedSessions: t._count.sessions,
          },
        },
        tx,
      );
    });
    purged += 1;
  }

  return NextResponse.json({ swept: stale.length, aborted, reported, purged });
}

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env['CRON_SECRET'];
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}
