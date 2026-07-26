import { NextResponse, type NextRequest } from 'next/server';
import type { MarketingStatsResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { istDay } from '@/lib/profile-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/psychologists/me/marketing/stats — MK6, the four-step
 * funnel over the rolling 7 IST days (views → slot views → requests →
 * confirms) plus median time-to-confirm over 30 days.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psyId = auth.value.psychologistId;
  const now = new Date();
  const weekAgoDay = istDay(new Date(now.getTime() - 6 * 24 * 60 * 60_000));
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

  const [counters, requests, confirms, confirmedRows] = await Promise.all([
    prisma.profileMetricDaily.groupBy({
      by: ['kind'],
      where: { psychologistId: psyId, day: { gte: weekAgoDay } },
      _sum: { count: true },
    }),
    prisma.appointment.count({
      where: { psychologistId: psyId, createdAt: { gte: weekAgo } },
    }),
    prisma.appointment.count({
      where: { psychologistId: psyId, status: 'CONFIRMED', updatedAt: { gte: weekAgo } },
    }),
    prisma.appointment.findMany({
      where: { psychologistId: psyId, status: 'CONFIRMED', createdAt: { gte: monthAgo } },
      select: { createdAt: true, updatedAt: true },
      take: 500,
    }),
  ]);

  const sums = new Map(counters.map((c) => [c.kind, c._sum.count ?? 0]));

  // updatedAt approximates the confirm instant (the row's last
  // transition); good enough for a median trend line.
  const waits = confirmedRows
    .map((r) => (r.updatedAt.getTime() - r.createdAt.getTime()) / 60_000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const median = waits.length === 0 ? null : Math.round(waits[Math.floor((waits.length - 1) / 2)]!);

  const body: MarketingStatsResponse = {
    week: {
      pageViews: sums.get('PAGE_VIEW') ?? 0,
      slotViews: sums.get('SLOT_VIEW') ?? 0,
      requests,
      confirms,
    },
    medianTimeToConfirmMinutes: median,
  };
  return NextResponse.json(body);
}
