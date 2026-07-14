import { NextResponse, type NextRequest } from 'next/server';
import { decideCareCronNudge, type CareNudgeKind } from '@/lib/care-nudge';
import { recordAndSendCareNudge } from '@/lib/care-nudge-send';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { istDayKey } from '@/lib/care-streak';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * CG4 — GET /api/v1/cron/care-nudges (hourly; vercel.json). Walks opted-in
 * ACTIVE accounts, runs the ONE suppression predicate + the pure channel
 * policy (care-nudge.ts), and delivers at most one discreet template per
 * user per day inside their quiet-hours window. Every decision lands as a
 * CareNudge row — SUPPRESSED rows prove the "no sends during
 * vulnerability" invariant instead of asserting it.
 *
 * Auth mirrors the other cron routes: x-vercel-cron OR CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowMs = Date.now();
  const istNow = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const istHour = istNow.getUTCHours();
  const istDow = istNow.getUTCDay();
  const todayKey = istDayKey(new Date());

  // Pilot-scale walk (bounded): per-user lookups below stay acceptable at
  // this size; revisit with batched queries past ~500 opted-in users.
  const users = await prisma.careUser.findMany({
    // Graduates get ZERO re-engagement — celebrating users leaving only
    // works if we actually leave them alone (ethics charter #10).
    where: { whatsappOptInAt: { not: null }, status: 'ACTIVE', graduatedAt: null },
    select: {
      id: true,
      displayName: true,
      phone: true,
      status: true,
      safetyHoldAt: true,
      whatsappOptInAt: true,
      nudgePrefs: true,
    },
    take: 500,
  });

  let sent = 0;
  let suppressed = 0;
  for (const user of users) {
    const [lastCheckin, lastSession, lastCrisis, latestReport, recentCheckins, recentNudges] =
      await Promise.all([
        prisma.careCheckin.findFirst({
          where: { careUserId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        prisma.careSession.findFirst({
          where: { careUserId: user.id, status: 'COMPLETED' },
          orderBy: { endedAt: 'desc' },
          select: { endedAt: true },
        }),
        prisma.careSession.findFirst({
          where: { careUserId: user.id, crisisAt: { not: null } },
          orderBy: { crisisAt: 'desc' },
          select: { crisisAt: true },
        }),
        prisma.careReport.findFirst({
          where: { careSession: { careUserId: user.id } },
          orderBy: { createdAt: 'desc' },
          select: { riskLevel: true },
        }),
        prisma.careCheckin.findMany({
          where: { careUserId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { mood: true },
        }),
        prisma.careNudge.findMany({
          where: {
            careUserId: user.id,
            createdAt: { gte: new Date(nowMs - 45 * 24 * 60 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
          select: { kind: true, status: true, istDay: true, createdAt: true },
        }),
      ]);

    const lastActivityMs = Math.max(
      lastCheckin?.createdAt.getTime() ?? 0,
      lastSession?.endedAt?.getTime() ?? 0,
    );
    // Never-active accounts (no session, no check-in) are onboarding
    // drop-offs — re-engagement is not this channel's job.
    if (lastActivityMs === 0) continue;
    const daysSinceLastActivity = Math.floor((nowMs - lastActivityMs) / (24 * 60 * 60 * 1000));

    const suppression = evaluateCareSuppression({
      status: user.status,
      safetyHoldAt: user.safetyHoldAt,
      lastCrisisAt: lastCrisis?.crisisAt ?? null,
      latestRiskLevel: latestReport?.riskLevel ?? null,
      worseningVerdict: false, // verdicts need ≥2 scores; the acute signals above cover the cron case
      recentMoods: recentCheckins.map((c) => c.mood),
    });

    const prefs = (user.nudgePrefs ?? {}) as {
      windowStartHour?: number;
      sessionDays?: number[];
    };
    const sentRows = recentNudges.filter((n) => n.status === 'SENT');
    const ladderSince = (kind: string): boolean =>
      sentRows.some((n) => n.kind === kind && n.createdAt.getTime() > lastActivityMs);

    const decision = decideCareCronNudge({
      whatsappOptInAt: user.whatsappOptInAt,
      suppress: suppression.suppress,
      istHour,
      istDow,
      windowStartHour: prefs.windowStartHour ?? null,
      sessionDays: prefs.sessionDays ?? null,
      daysSinceLastActivity,
      sentLast7Days: sentRows.filter((n) => n.createdAt.getTime() > nowMs - 7 * 24 * 60 * 60 * 1000)
        .length,
      sentToday: recentNudges.some((n) => n.istDay === todayKey),
      ladderSentThisLapse: {
        d3: ladderSince('LADDER_D3'),
        d7: ladderSince('LADDER_D7'),
        d30: ladderSince('LADDER_D30'),
      },
    });
    if (!decision) continue;

    const result = await recordAndSendCareNudge(
      {
        careUserId: user.id,
        phone: user.phone,
        firstName: user.displayName.split(' ')[0] ?? user.displayName,
      },
      decision.kind as CareNudgeKind,
    );
    if (result === 'SENT') sent += 1;
    if (result === 'SUPPRESSED') suppressed += 1;
  }

  return NextResponse.json({ checked: users.length, sent, suppressed });
}

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true;
  const secret = process.env['CRON_SECRET'];
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}
