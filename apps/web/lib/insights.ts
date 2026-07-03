import type {
  CardTypeStats,
  DismissReason,
  DismissReasonStat,
  DoctorInsights,
  InsightsCatch,
} from '@cureocity/contracts';
import { PILOT_TARGETS } from '@cureocity/contracts';
import type { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { istDayRange } from '@/lib/clinic-queue';

/** The rollup window: the last N IST clinic days (default 1, clamped 1..90). */
export function insightsWindow(url: string): { from: Date; to: Date; days: number } {
  const days = Math.min(
    90,
    Math.max(1, Math.floor(Number(new URL(url).searchParams.get('days')) || 1)),
  );
  const { end } = istDayRange(new Date());
  return { from: new Date(end.getTime() - days * 86_400_000), to: end, days };
}

/**
 * Sprint DS9 — the pilot-metrics rollup ("the evidence engine").
 *
 * Composes `/app/insights` + the CSV export entirely from already-persisted
 * data (LiveConsultMetric + LIVE_SUGGESTION_* audit rows + Session). No new
 * writes — the pilot dataset is a read model. See DS9 in the sprint plan.
 */

const SUGGESTION_ACTIONS = [
  'LIVE_SUGGESTION_SHOWN',
  'LIVE_SUGGESTION_ACTED',
  'LIVE_SUGGESTION_DISMISSED',
  'LIVE_SUGGESTION_AUTORESOLVED',
] as const;

const CARD_KINDS = ['DIFFERENTIAL', 'ASK_NEXT', 'RED_FLAG', 'GAP'] as const;
type CardKind = (typeof CARD_KINDS)[number];

interface SuggestionMeta {
  kind?: string;
  label?: string;
  dismissReason?: string;
}

function metaOf(m: unknown): SuggestionMeta {
  return m && typeof m === 'object' ? (m as SuggestionMeta) : {};
}

export async function loadDoctorInsights(
  psychologistId: string,
  from: Date,
  to: Date,
): Promise<DoctorInsights> {
  const [metrics, totalSessions, suggestionRows] = await Promise.all([
    prisma.liveConsultMetric.findMany({
      where: { psychologistId, createdAt: { gte: from, lt: to } },
      select: { costInr: true, elapsedMs: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.session.count({ where: { psychologistId, scheduledAt: { gte: from, lt: to } } }),
    prisma.auditLog.findMany({
      where: {
        actorPsychologistId: psychologistId,
        action: { in: SUGGESTION_ACTIONS as unknown as AuditAction[] },
        createdAt: { gte: from, lt: to },
      },
      select: { action: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const consults = metrics.length;

  // --- consult length / cost / throughput ---------------------------------
  const totalElapsedMs = metrics.reduce((n, m) => n + m.elapsedMs, 0);
  const avgConsultMinutes = consults ? totalElapsedMs / consults / 60_000 : null;
  const avgCostInr = consults
    ? metrics.reduce((n, m) => n + Number(m.costInr), 0) / consults
    : null;
  let tokensPerHour: number | null = null;
  if (consults > 0) {
    const spanMs = metrics.at(-1)!.createdAt.getTime() - metrics[0]!.createdAt.getTime();
    // Floor the active window at the summed consult time so a burst of
    // consults in a few minutes doesn't report an absurd hourly rate.
    const activeHours = Math.max(spanMs, totalElapsedMs) / 3_600_000;
    tokensPerHour = activeHours > 0 ? consults / activeHours : consults;
  }

  // --- per-card acceptance funnel -----------------------------------------
  const tally: Record<CardKind, { shown: number; acted: number; dismissed: number; auto: number }> =
    {
      DIFFERENTIAL: { shown: 0, acted: 0, dismissed: 0, auto: 0 },
      ASK_NEXT: { shown: 0, acted: 0, dismissed: 0, auto: 0 },
      RED_FLAG: { shown: 0, acted: 0, dismissed: 0, auto: 0 },
      GAP: { shown: 0, acted: 0, dismissed: 0, auto: 0 },
    };
  const dismissReasonCounts = new Map<DismissReason, number>();
  const catches: InsightsCatch[] = [];
  const seenCatch = new Set<string>();

  for (const row of suggestionRows) {
    const meta = metaOf(row.metadata);
    const kind = (CARD_KINDS as readonly string[]).includes(meta.kind ?? '')
      ? (meta.kind as CardKind)
      : null;
    if (!kind) continue;
    const bucket = tally[kind];
    if (row.action === 'LIVE_SUGGESTION_SHOWN') bucket.shown++;
    else if (row.action === 'LIVE_SUGGESTION_ACTED') {
      bucket.acted++;
      if (kind === 'RED_FLAG' && meta.label && !seenCatch.has(meta.label) && catches.length < 8) {
        seenCatch.add(meta.label);
        catches.push({ label: meta.label, at: row.createdAt.toISOString() });
      }
    } else if (row.action === 'LIVE_SUGGESTION_DISMISSED') {
      bucket.dismissed++;
      const r = meta.dismissReason as DismissReason | undefined;
      if (r) dismissReasonCounts.set(r, (dismissReasonCounts.get(r) ?? 0) + 1);
    } else if (row.action === 'LIVE_SUGGESTION_AUTORESOLVED') bucket.auto++;
  }

  const cards: CardTypeStats[] = CARD_KINDS.map((kind) => {
    const b = tally[kind];
    return {
      kind,
      shown: b.shown,
      acted: b.acted,
      dismissed: b.dismissed,
      autoResolved: b.auto,
      actRate: b.shown > 0 ? b.acted / b.shown : null,
    };
  });
  const askNext = cards.find((c) => c.kind === 'ASK_NEXT')!;
  const dismissReasons: DismissReasonStat[] = [...dismissReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    consults,
    totalSessions,
    activationRate: totalSessions > 0 ? consults / totalSessions : null,
    avgConsultMinutes,
    tokensPerHour,
    avgCostInr,
    criticalsCaught: tally.RED_FLAG.acted,
    cards,
    askNextActRate: askNext.actRate,
    dismissReasons,
    rxOneEditRate: null, // pending the signed-vs-drafted Rx diff (DS5 follow-up)
    catches,
    targets: PILOT_TARGETS,
  };
}
