import { computeInstrumentChange, type InstrumentKey } from '@cureocity/clinical';
import type { JourneyStage } from '@cureocity/contracts';
import { fetchOpenCrises } from './crisis-flags';
import { decryptClientField } from './client-pii';
import { computeDayBoundaries } from './ist';
import { prisma } from './prisma';

/**
 * Sprint 57 — Dashboard ("command center") data composer.
 *
 * A read-only, action-oriented triage hub assembled from the cumulative
 * tables — no new storage. Mirrors the ownership + demo-exclusion rules of
 * `me/page.tsx` (every query filters `psychologistId` + `isDemo: false`).
 *
 * Performance: the per-client Journey composer (`journey.ts`) runs ~7
 * queries PER client and is deliberately NOT looped here. Instead the
 * caseload pulse is computed from a fixed handful of aggregate queries over
 * the clients with an OPEN treatment episode (the active-care denominator),
 * and the crisis fan-out is bounded. See `buildDashboard` for the two-wave
 * query plan.
 */

const TRACKED_INSTRUMENTS: InstrumentKey[] = ['PHQ9', 'GAD7'];
/** Completed sessions since plan confirmation that trigger a re-eval. Mirrors
 *  REVIEW_THRESHOLD_SESSIONS in journey.ts — keep in sync. */
const REVIEW_THRESHOLD_SESSIONS = 8;
/** A measure older than this is "due" for re-administration. */
const MEASURE_STALE_DAYS = 14;
/** Max clients we run the (5-report) crisis scan over on one render. */
const CRISIS_FANOUT_CAP = 30;
/** Hero rows shown per bucket before the "+N more" overflow link. */
const HERO_ROWS = 5;

export interface DashboardData {
  greetingName: string;
  metrics: DashboardMetrics;
  attention: AttentionData;
  caseloadPulse: CaseloadPulse;
  upNext: UpNextSession[];
  recentSessions: RecentSessionGroup[];
  /** True when the therapist has no clients + no sessions (first-run). */
  isEmpty: boolean;
  /** UI truth pass — every tally here excludes the seeded example client.
   * When one exists, empty states say so; otherwise "0 here, 6 sessions on
   * the Record page" reads as the app contradicting itself. */
  hasDemoClient: boolean;
}

export interface DashboardMetrics {
  activeClients: number;
  sessionsThisWeek: number;
  unsignedNotes: number;
  openCrises: number;
  measuresDue: number;
}

export interface CrisisRow {
  clientId: string;
  clientName: string;
  kind: string;
  severity: 'high' | 'critical';
  lastSeenAt: string;
}
export interface DeterioratingRow {
  clientId: string;
  clientName: string;
  instrumentKey: InstrumentKey;
  delta: number;
}
export interface UnsignedNoteRow {
  sessionId: string;
  clientId: string;
  clientName: string;
  sessionEndedAt: string | null;
}
export interface MeasureDueRow {
  clientId: string;
  clientName: string;
  reason: 'STALE_MEASURE' | 'REVIEW_DUE';
  lastAdministeredAt: string | null;
}
export interface AttentionData {
  crises: CrisisRow[];
  deteriorating: DeterioratingRow[];
  unsignedNotes: UnsignedNoteRow[];
  measuresDue: MeasureDueRow[];
  /** Total rows that exist per bucket (the lists above are capped at HERO_ROWS). */
  totals: { crises: number; deteriorating: number; unsignedNotes: number; measuresDue: number };
  /** Crisis scan was capped at CRISIS_FANOUT_CAP candidates. */
  truncated: boolean;
}

export interface CaseloadPulse {
  totalActive: number;
  stageCounts: Record<JourneyStage, number>;
  change: { improving: number; deteriorating: number; remission: number; tracked: number };
  cadenceDrift: number;
}

export interface UpNextSession {
  id: string;
  clientId: string;
  clientName: string;
  scheduledAt: string;
  modality: string | null;
  status: 'SCHEDULED' | 'IN_PROGRESS';
}
export interface RecentSessionRow {
  id: string;
  clientId: string;
  clientName: string;
  scheduledAt: string;
  modality: string | null;
}
export interface RecentSessionGroup {
  label: string;
  rows: RecentSessionRow[];
}

const emptyStageCounts = (): Record<JourneyStage, number> => ({
  INTAKE: 0,
  ASSESSMENT: 0,
  ACTIVE_TREATMENT: 0,
  REVIEW_DUE: 0,
  DISCHARGE_READY: 0,
  DISCHARGED: 0,
});

const HERO_FETCH = HERO_ROWS + 1; // one extra to know if "+N more" is needed

export async function buildDashboard(
  psychologistId: string,
  greetingName: string,
): Promise<DashboardData> {
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { startOfToday, lookAheadEnd } = computeDayBoundaries(now);
  const nonDemo = { client: { isDemo: false, deletedAt: null } } as const;

  // ---- Wave 1: independent aggregates (parallel) -------------------------
  const [
    activeClients,
    sessionsThisWeek,
    unsignedCount,
    unsignedRowsRaw,
    upNextRowsRaw,
    recentRowsRaw,
    candidatesRaw,
    demoClientCount,
  ] = await Promise.all([
    prisma.client.count({
      where: { psychologistId, status: 'ACTIVE', deletedAt: null, isDemo: false },
    }),
    prisma.session.count({
      where: { psychologistId, status: 'COMPLETED', endedAt: { gte: since7d }, ...nonDemo },
    }),
    prisma.session.count({
      where: {
        psychologistId,
        noteDraft: { status: 'COMPLETED' },
        therapyNote: { is: null },
        ...nonDemo,
      },
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        noteDraft: { status: 'COMPLETED' },
        therapyNote: { is: null },
        ...nonDemo,
      },
      orderBy: { endedAt: 'desc' },
      take: HERO_FETCH,
      select: {
        id: true,
        clientId: true,
        endedAt: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.session.findMany({
      where: {
        psychologistId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        scheduledAt: { gte: startOfToday, lt: lookAheadEnd },
        ...nonDemo,
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        modality: true,
        status: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.session.findMany({
      where: { psychologistId, status: 'COMPLETED', ...nonDemo },
      orderBy: { endedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        modality: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.treatmentEpisode.findMany({
      where: { psychologistId, status: 'OPEN', client: { isDemo: false, deletedAt: null } },
      orderBy: { openedAt: 'desc' },
      select: { clientId: true, client: { select: { fullNameEncrypted: true } } },
    }),
    prisma.client.count({ where: { psychologistId, isDemo: true, deletedAt: null } }),
  ]);

  // PII read cutover — the client name is envelope-encrypted, so decrypt it
  // onto each row (all rows belong to `psychologistId`) before the
  // deterministic mappers below read `.client.fullName`.
  const attachClientName = async <T extends { client: { fullNameEncrypted: string | null } }>(
    rows: readonly T[],
  ): Promise<(T & { client: T['client'] & { fullName: string } })[]> =>
    Promise.all(
      rows.map(async (r) => ({
        ...r,
        client: {
          ...r.client,
          fullName: await decryptClientField(psychologistId, r.client.fullNameEncrypted),
        },
      })),
    );
  const [unsignedRows, upNextRows, recentRows, candidates] = await Promise.all([
    attachClientName(unsignedRowsRaw),
    attachClientName(upNextRowsRaw),
    attachClientName(recentRowsRaw),
    attachClientName(candidatesRaw),
  ]);

  const candidateIds = candidates.map((c) => c.clientId);
  const nameById = new Map(candidates.map((c) => [c.clientId, c.client.fullName]));

  // ---- Wave 2: caseload pulse + bounded crisis fan-out (parallel) --------
  const crisisCandidates = candidates.slice(0, CRISIS_FANOUT_CAP);
  const [completedRows, planRows, instrumentRows, crisisResults] = await Promise.all([
    candidateIds.length
      ? prisma.session.findMany({
          where: { clientId: { in: candidateIds }, status: 'COMPLETED' },
          select: { clientId: true, endedAt: true },
        })
      : Promise.resolve([] as { clientId: string; endedAt: Date | null }[]),
    candidateIds.length
      ? prisma.treatmentPlan.findMany({
          where: { clientId: { in: candidateIds }, supersededAt: null },
          orderBy: { version: 'desc' },
          select: { clientId: true, confirmedAt: true },
        })
      : Promise.resolve([] as { clientId: string; confirmedAt: Date }[]),
    candidateIds.length
      ? prisma.instrumentResponse.findMany({
          where: { clientId: { in: candidateIds }, instrumentKey: { in: TRACKED_INSTRUMENTS } },
          orderBy: { administeredAt: 'asc' },
          select: { clientId: true, instrumentKey: true, score: true, administeredAt: true },
        })
      : Promise.resolve(
          [] as { clientId: string; instrumentKey: string; score: number; administeredAt: Date }[],
        ),
    Promise.all(
      crisisCandidates.map(async (c) => ({
        clientId: c.clientId,
        clientName: c.client.fullName,
        crises: await fetchOpenCrises(c.clientId),
      })),
    ),
  ]);

  // ---- Derive caseload pulse + attention (deterministic, in JS) ----------
  const perClient = foldCandidateData(candidateIds, completedRows, planRows, instrumentRows);

  const stageCounts = emptyStageCounts();
  const change = { improving: 0, deteriorating: 0, remission: 0, tracked: 0 };
  const deteriorating: DeterioratingRow[] = [];
  const measuresDue: MeasureDueRow[] = [];
  let cadenceDrift = 0;
  const drift30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const id of candidateIds) {
    const c = perClient.get(id)!;
    stageCounts[c.stage]++;

    if (c.lastEndedAt === null || c.lastEndedAt < drift30d) cadenceDrift++;

    if (c.tracked) {
      change.tracked++;
      if (c.anyImproving) change.improving++;
      if (c.anyDeteriorating) change.deteriorating++;
      if (c.anyRemission) change.remission++;
    }
    for (const d of c.deteriorations) {
      deteriorating.push({
        clientId: id,
        clientName: nameById.get(id) ?? 'Client',
        instrumentKey: d.key,
        delta: d.delta,
      });
    }

    // Measures due: a stale prior measure, OR a plan aged into review.
    if (c.stage === 'REVIEW_DUE') {
      measuresDue.push({
        clientId: id,
        clientName: nameById.get(id) ?? 'Client',
        reason: 'REVIEW_DUE',
        lastAdministeredAt: c.lastMeasureAt?.toISOString() ?? null,
      });
    } else if (
      c.lastMeasureAt &&
      c.lastMeasureAt < new Date(now.getTime() - MEASURE_STALE_DAYS * 86_400_000)
    ) {
      measuresDue.push({
        clientId: id,
        clientName: nameById.get(id) ?? 'Client',
        reason: 'STALE_MEASURE',
        lastAdministeredAt: c.lastMeasureAt.toISOString(),
      });
    }
  }

  // Crisis rows (deduped per (client, kind), already deduped per-client by
  // fetchOpenCrises). Sort critical-first then most-recent.
  const crises: CrisisRow[] = [];
  for (const r of crisisResults) {
    for (const f of r.crises) {
      crises.push({
        clientId: r.clientId,
        clientName: r.clientName,
        kind: f.kind,
        severity: f.severity,
        lastSeenAt: f.lastSeenAt,
      });
    }
  }
  crises.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  const unsignedNotes: UnsignedNoteRow[] = unsignedRows.slice(0, HERO_ROWS).map((s) => ({
    sessionId: s.id,
    clientId: s.clientId,
    clientName: s.client.fullName,
    sessionEndedAt: s.endedAt?.toISOString() ?? null,
  }));

  const attention: AttentionData = {
    crises: crises.slice(0, HERO_ROWS),
    deteriorating: deteriorating.slice(0, HERO_ROWS),
    unsignedNotes,
    measuresDue: measuresDue.slice(0, HERO_ROWS),
    totals: {
      crises: crises.length,
      deteriorating: deteriorating.length,
      unsignedNotes: unsignedCount,
      measuresDue: measuresDue.length,
    },
    truncated: candidates.length > CRISIS_FANOUT_CAP,
  };

  const metrics: DashboardMetrics = {
    activeClients,
    sessionsThisWeek,
    unsignedNotes: unsignedCount,
    openCrises: crises.length,
    measuresDue: measuresDue.length,
  };

  const caseloadPulse: CaseloadPulse = {
    totalActive: candidateIds.length,
    stageCounts,
    change,
    cadenceDrift,
  };

  const upNext: UpNextSession[] = upNextRows.map((s) => ({
    id: s.id,
    clientId: s.clientId,
    clientName: s.client.fullName,
    scheduledAt: s.scheduledAt.toISOString(),
    modality: s.modality,
    status: s.status as 'SCHEDULED' | 'IN_PROGRESS',
  }));

  const recentSessions = groupRecentByDate(
    recentRows.map((s) => ({
      id: s.id,
      clientId: s.clientId,
      clientName: s.client.fullName,
      scheduledAt: s.scheduledAt,
      modality: s.modality,
    })),
  );

  const isEmpty = activeClients === 0 && recentRows.length === 0 && upNextRows.length === 0;

  return {
    greetingName,
    metrics,
    attention,
    caseloadPulse,
    upNext,
    recentSessions,
    isEmpty,
    hasDemoClient: demoClientCount > 0,
  };
}

// ---------------------------------------------------------------------------
// Per-candidate fold — lightweight stage + change signals, no journey loop.
// ---------------------------------------------------------------------------

interface CandidateSignals {
  stage: JourneyStage;
  lastEndedAt: Date | null;
  lastMeasureAt: Date | null;
  tracked: boolean;
  anyImproving: boolean;
  anyDeteriorating: boolean;
  anyRemission: boolean;
  deteriorations: { key: InstrumentKey; delta: number }[];
}

function foldCandidateData(
  candidateIds: string[],
  completedRows: { clientId: string; endedAt: Date | null }[],
  planRows: { clientId: string; confirmedAt: Date }[],
  instrumentRows: {
    clientId: string;
    instrumentKey: string;
    score: number;
    administeredAt: Date;
  }[],
): Map<string, CandidateSignals> {
  // Index the raw rows by client.
  const completedByClient = new Map<string, Date[]>();
  for (const r of completedRows) {
    if (!r.endedAt) continue;
    const arr = completedByClient.get(r.clientId) ?? [];
    arr.push(r.endedAt);
    completedByClient.set(r.clientId, arr);
  }
  // First (latest-version) plan confirmedAt per client.
  const planConfirmedByClient = new Map<string, Date>();
  for (const p of planRows) {
    if (!planConfirmedByClient.has(p.clientId))
      planConfirmedByClient.set(p.clientId, p.confirmedAt);
  }
  // Instrument series per (client, key), already ordered asc by query.
  const seriesByClient = new Map<string, Map<InstrumentKey, { score: number; at: Date }[]>>();
  for (const r of instrumentRows) {
    const key = r.instrumentKey as InstrumentKey;
    if (key !== 'PHQ9' && key !== 'GAD7') continue;
    const byKey = seriesByClient.get(r.clientId) ?? new Map();
    const arr = byKey.get(key) ?? [];
    arr.push({ score: r.score, at: r.administeredAt });
    byKey.set(key, arr);
    seriesByClient.set(r.clientId, byKey);
  }

  const out = new Map<string, CandidateSignals>();
  for (const id of candidateIds) {
    const completed = completedByClient.get(id) ?? [];
    const completedCount = completed.length;
    const lastEndedAt = completed.reduce<Date | null>(
      (max, d) => (max === null || d > max ? d : max),
      null,
    );
    const planConfirmedAt = planConfirmedByClient.get(id) ?? null;
    const hasActivePlan = planConfirmedAt !== null;
    const sessionsSincePlan = planConfirmedAt
      ? completed.filter((d) => d >= planConfirmedAt).length
      : 0;

    // Per-instrument change from first + last administration (≥2 needed).
    const byKey = seriesByClient.get(id);
    let tracked = false;
    let anyImproving = false;
    let anyDeteriorating = false;
    let anyRemission = false;
    let dischargeReady = false;
    let lastMeasureAt: Date | null = null;
    const deteriorations: { key: InstrumentKey; delta: number }[] = [];

    if (byKey) {
      for (const key of TRACKED_INSTRUMENTS) {
        const series = byKey.get(key);
        if (!series || series.length === 0) continue;
        const seriesLast = series[series.length - 1]!;
        if (lastMeasureAt === null || seriesLast.at > lastMeasureAt) lastMeasureAt = seriesLast.at;
        if (series.length < 2) continue;
        tracked = true;
        const change = computeInstrumentChange(key, series[0]!.score, seriesLast.score);
        if (change.verdict === 'reliable_improvement') anyImproving = true;
        if (change.verdict === 'deterioration') {
          anyDeteriorating = true;
          deteriorations.push({ key, delta: change.delta });
        }
        if (change.isRemission) anyRemission = true;
        if (
          change.isRemission &&
          (change.verdict === 'reliable_improvement' || change.isResponse)
        ) {
          dischargeReady = true;
        }
      }
    }

    const stage = deriveStageLite({
      completedCount,
      hasActivePlan,
      sessionsSincePlan,
      dischargeReady,
    });

    out.set(id, {
      stage,
      lastEndedAt,
      lastMeasureAt,
      tracked,
      anyImproving,
      anyDeteriorating,
      anyRemission,
      deteriorations,
    });
  }
  return out;
}

/**
 * Lightweight stage derivation. Mirrors `deriveStage` in journey.ts (kept
 * in sync via REVIEW_THRESHOLD_SESSIONS). The DISCHARGED stage is never
 * produced here because the candidate set is OPEN episodes only — a
 * discharged client has no open episode and is out of the active caseload
 * the pulse describes.
 */
function deriveStageLite(input: {
  completedCount: number;
  hasActivePlan: boolean;
  sessionsSincePlan: number;
  dischargeReady: boolean;
}): JourneyStage {
  if (input.completedCount === 0) return 'INTAKE';
  if (!input.hasActivePlan) return 'ASSESSMENT';
  if (input.dischargeReady) return 'DISCHARGE_READY';
  if (input.sessionsSincePlan >= REVIEW_THRESHOLD_SESSIONS) return 'REVIEW_DUE';
  return 'ACTIVE_TREATMENT';
}

function groupRecentByDate(
  rows: {
    id: string;
    clientId: string;
    clientName: string;
    scheduledAt: Date;
    modality: string | null;
  }[],
): RecentSessionGroup[] {
  const groups = new Map<string, RecentSessionGroup>();
  for (const r of rows) {
    const key = r.scheduledAt.toISOString().slice(0, 10);
    const label = r.scheduledAt.toLocaleDateString('en-IN', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const row: RecentSessionRow = {
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      scheduledAt: r.scheduledAt.toISOString(),
      modality: r.modality,
    };
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    else groups.set(key, { label, rows: [row] });
  }
  return Array.from(groups.values());
}

/** "Dr. Priya Menon" → "Dr. Priya"; "Priya Menon" → "Priya". */
export function greetingNameFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  const honorifics = new Set([
    'dr',
    'dr.',
    'mr',
    'mr.',
    'ms',
    'ms.',
    'mrs',
    'mrs.',
    'prof',
    'prof.',
  ]);
  if (parts.length >= 2 && honorifics.has(parts[0]!.toLowerCase())) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0]!;
}
