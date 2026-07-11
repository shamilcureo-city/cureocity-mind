import { NextResponse, type NextRequest } from 'next/server';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/cron/reclaim-stuck — NEXT2.
 *
 * Pass 2 runs inline and Pass 3 runs in after(); on Vercel Hobby the
 * shared maxDuration sometimes kills them mid-flight, stranding a
 * NoteDraft at IN_PROGRESS or a ClinicalReport at PENDING forever. The
 * UI then shows an infinite spinner with no re-run offer (the re-run
 * paths key off FAILED / absent). This cron flips anything stranded
 * longer than RECLAIM_AFTER_MINUTES to FAILED so the existing retry
 * affordances light up. Purely a status flip — no content is touched,
 * and a generation that is genuinely still running is safe because the
 * window is far beyond any function budget.
 */
const RECLAIM_AFTER_MINUTES = Number(process.env['RECLAIM_AFTER_MINUTES'] ?? 30);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RECLAIM_AFTER_MINUTES * 60 * 1000);

  const stuckDrafts = await prisma.noteDraft.findMany({
    where: { status: 'IN_PROGRESS', updatedAt: { lt: cutoff } },
    select: { id: true, sessionId: true, updatedAt: true },
    take: 100,
  });
  const stuckReports = await prisma.clinicalReport.findMany({
    where: { status: 'PENDING', updatedAt: { lt: cutoff } },
    select: { id: true, sessionId: true, updatedAt: true },
    take: 100,
  });

  for (const d of stuckDrafts) {
    await prisma.$transaction(async (tx) => {
      await tx.noteDraft.update({
        where: { id: d.id },
        data: {
          status: 'FAILED',
          errorMessage: `Reclaimed by cron after ${RECLAIM_AFTER_MINUTES}m stuck IN_PROGRESS`,
        },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'STUCK_GENERATION_RECLAIMED',
          targetType: 'NoteDraft',
          targetId: d.id,
          metadata: {
            sessionId: d.sessionId,
            kind: 'NOTE_DRAFT',
            stuckSince: d.updatedAt.toISOString(),
            reclaimAfterMinutes: RECLAIM_AFTER_MINUTES,
          },
        },
        tx,
      );
    });
  }

  for (const r of stuckReports) {
    await prisma.$transaction(async (tx) => {
      await tx.clinicalReport.update({
        where: { id: r.id },
        data: { status: 'FAILED' },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'STUCK_GENERATION_RECLAIMED',
          targetType: 'ClinicalReport',
          targetId: r.id,
          metadata: {
            sessionId: r.sessionId,
            kind: 'CLINICAL_REPORT',
            stuckSince: r.updatedAt.toISOString(),
            reclaimAfterMinutes: RECLAIM_AFTER_MINUTES,
          },
        },
        tx,
      );
    });
  }

  return NextResponse.json({
    cutoff: cutoff.toISOString(),
    reclaimAfterMinutes: RECLAIM_AFTER_MINUTES,
    noteDraftsReclaimed: stuckDrafts.length,
    clinicalReportsReclaimed: stuckReports.length,
  });
}

function isAuthorized(req: NextRequest): boolean {
  // Fail closed (AUD1 pattern): CRON_SECRET must be set and presented.
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing all cron invocations (fail closed).');
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
