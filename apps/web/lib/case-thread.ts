import {
  INSTRUMENTS,
  REMISSION_CUTOFF,
  computeInstrumentChange,
  severityKeyForScore,
  type ChangeVerdict,
  type InstrumentKey,
} from '@cureocity/clinical';
import type { SessionKind } from '@cureocity/contracts';
import { prisma } from './prisma';

/** Instruments threaded on the note (mirrors journey.ts). */
const TRACKED_INSTRUMENTS: InstrumentKey[] = ['PHQ9', 'GAD7'];
const INSTRUMENT_SHORT_LABEL: Record<InstrumentKey, string> = { PHQ9: 'PHQ-9', GAD7: 'GAD-7' };

/**
 * Sprint 73 — case thread (document continuity).
 *
 * Every session document opens as an island today: nothing tells the
 * therapist that the note they're reading continues an arc, or what
 * carried over from last time. This composer stitches the pile of
 * per-session documents into one visible thread — deterministically,
 * from the cumulative tables (no new storage, no LLM pass, so it's
 * safe to render on a clinical surface and free to compute).
 *
 * It returns two things, mirroring the ownership + error shape of
 * `journey.ts`:
 *   - `position`  — where this session sits in the client's timeline,
 *                   plus the chronological neighbours for prev/next nav.
 *   - `previous`  — a "where we left off" recap for the most recent
 *                   COMPLETED session before this one (null on the very
 *                   first session, which is honestly a fresh start).
 */

export class CaseThreadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseThreadError';
  }
}

export interface CaseThreadPosition {
  /** 1-based rank of this session in the client's timeline (by scheduledAt). */
  index: number;
  /** Total sessions on record for the client. */
  total: number;
  /** Chronologically previous session (any status), for ‹ prev nav. */
  prevSessionId: string | null;
  /** Chronologically next session (any status), for next › nav. */
  nextSessionId: string | null;
}

export interface CaseThreadRisk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  items: string[];
}

export interface CaseThreadPrevious {
  lastSession: {
    id: string;
    at: string;
    modality: string | null;
    kind: SessionKind;
    /** 1-based ordinal of the last session, for "since session N". */
    ordinal: number;
    /** One-line, deterministically extracted from the last note. */
    recap: string | null;
    /** True when the last session's note is signed (recap is authoritative). */
    signed: boolean;
  };
  /** Current working (primary, non-superseded) diagnosis. */
  diagnosis: { code: string; label: string } | null;
  /** Active problem-list titles — the running threads of the work. */
  openThreads: string[];
  /** Carry-over risk from the last note's riskFlags — safety-critical. */
  carryoverRisk: CaseThreadRisk | null;
}

export interface MeasureTrend {
  key: InstrumentKey;
  /** Short display label, e.g. "PHQ-9". */
  shortLabel: string;
  /** Instrument ceiling (PHQ-9 = 27, GAD-7 = 21) — the sparkline y-scale. */
  max: number;
  /** Score at or below which counts as remission — drawn as a guide line. */
  remissionCutoff: number;
  /** Full chronological series. */
  points: { score: number; at: string }[];
  baseline: number;
  latest: number;
  /** latest − baseline (negative = improvement; lower is better). */
  delta: number;
  verdict: ChangeVerdict;
  isRemission: boolean;
  /** Plain-language severity band of the latest score. */
  latestSeverityLabel: string;
}

export interface CaseThread {
  isFirstSession: boolean;
  position: CaseThreadPosition;
  previous: CaseThreadPrevious | null;
  /** PHQ-9 / GAD-7 trends with ≥2 administrations — the score arc on the note. */
  measures: MeasureTrend[];
}

export async function computeCaseThread(
  sessionId: string,
  psychologistId: string,
): Promise<CaseThread> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, clientId: true, psychologistId: true, scheduledAt: true },
  });
  if (!session) throw new CaseThreadError('Session not found');
  if (session.psychologistId !== psychologistId) {
    throw new CaseThreadError('Session not owned by this psychologist');
  }
  const { clientId } = session;

  const [timeline, lastCompleted, primaryDiagnosis, activeProblems, instrumentRows] =
    await Promise.all([
      // Whole timeline for position + prev/next. Ordered so array index is rank.
      prisma.session.findMany({
        where: { clientId },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
      // The recap anchors on the most recent COMPLETED session before this one
      // (a cancelled/no-show session has nothing to carry over).
      prisma.session.findFirst({
        where: {
          clientId,
          status: 'COMPLETED',
          id: { not: sessionId },
          scheduledAt: { lt: session.scheduledAt },
        },
        orderBy: { scheduledAt: 'desc' },
        select: { id: true, scheduledAt: true, modality: true, kind: true },
      }),
      prisma.clientDiagnosis.findFirst({
        where: { clientId, supersededAt: null, isPrimary: true },
        orderBy: { confirmedAt: 'desc' },
        select: { icd11Code: true, icd11Label: true },
      }),
      prisma.problemListItem.findMany({
        where: { clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { title: true },
      }),
      // PHQ-9 / GAD-7 series for the score-trend sparkline on the note.
      prisma.instrumentResponse.findMany({
        where: { clientId, instrumentKey: { in: TRACKED_INSTRUMENTS } },
        orderBy: { administeredAt: 'asc' },
        select: { instrumentKey: true, score: true, administeredAt: true },
      }),
    ]);

  const measures = buildMeasures(instrumentRows);

  const idx = timeline.findIndex((s) => s.id === sessionId);
  const position: CaseThreadPosition = {
    index: idx >= 0 ? idx + 1 : 1,
    total: timeline.length,
    prevSessionId: idx > 0 ? (timeline[idx - 1]?.id ?? null) : null,
    nextSessionId: idx >= 0 && idx < timeline.length - 1 ? (timeline[idx + 1]?.id ?? null) : null,
  };

  if (!lastCompleted) {
    return { isFirstSession: true, position, previous: null, measures };
  }

  // 1-based ordinal of the last completed session in the timeline.
  const lastOrdinal = timeline.findIndex((s) => s.id === lastCompleted.id) + 1;

  // Prefer the signed note; fall back to the generated draft so an
  // unsigned-but-generated last session still threads.
  const [signedRow, draftRow] = await Promise.all([
    prisma.therapyNote.findUnique({
      where: { sessionId: lastCompleted.id },
      select: { content: true },
    }),
    prisma.noteDraft.findUnique({
      where: { sessionId: lastCompleted.id },
      select: { content: true },
    }),
  ]);
  const signed = signedRow?.content != null;
  const noteContent = signedRow?.content ?? draftRow?.content ?? null;

  return {
    isFirstSession: false,
    position,
    previous: {
      lastSession: {
        id: lastCompleted.id,
        at: lastCompleted.scheduledAt.toISOString(),
        modality: lastCompleted.modality,
        kind: lastCompleted.kind,
        ordinal: lastOrdinal > 0 ? lastOrdinal : 1,
        recap: deriveRecap(noteContent),
        signed,
      },
      diagnosis: primaryDiagnosis
        ? { code: primaryDiagnosis.icd11Code, label: primaryDiagnosis.icd11Label }
        : null,
      openThreads: activeProblems.map((p) => p.title),
      carryoverRisk: deriveCarryoverRisk(noteContent),
    },
    measures,
  };
}

/**
 * PHQ-9 / GAD-7 trends — only instruments with ≥2 administrations (a
 * sparkline needs at least two points). Reliable-change verdict comes
 * from the same deterministic engine the journey composer uses.
 */
function buildMeasures(
  rows: { instrumentKey: string; score: number; administeredAt: Date }[],
): MeasureTrend[] {
  const out: MeasureTrend[] = [];
  for (const key of TRACKED_INSTRUMENTS) {
    const series = rows.filter((r) => r.instrumentKey === key);
    if (series.length < 2) continue;
    const baseline = series[0]!.score;
    const latest = series[series.length - 1]!.score;
    const change = computeInstrumentChange(key, baseline, latest);
    const def = INSTRUMENTS[key];
    const bands = def.severityBands;
    const max = bands[bands.length - 1]!.max;
    const latestKey = severityKeyForScore(key, latest);
    const latestBand = bands.find((b) => b.key === latestKey);
    out.push({
      key,
      shortLabel: INSTRUMENT_SHORT_LABEL[key],
      max,
      remissionCutoff: REMISSION_CUTOFF[key],
      points: series.map((s) => ({ score: s.score, at: s.administeredAt.toISOString() })),
      baseline,
      latest,
      delta: change.delta,
      verdict: change.verdict,
      isRemission: change.isRemission,
      latestSeverityLabel: latestBand?.label.en ?? latestKey,
    });
  }
  return out;
}

// ============================================================================
// Deterministic extraction from a stored note (TherapyNoteV1 | IntakeNoteV1).
// Both shapes are validated JSON; we read defensively (a malformed row must
// degrade to "no recap", never throw — the page keeps rendering).
// ============================================================================

function deriveRecap(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;

  // TherapyNoteV1 (SOAP): summary → plan → assessment.
  if (typeof c['subjective'] === 'string') {
    return firstLine(str(c['summary']) || str(c['plan']) || str(c['assessment']));
  }
  // IntakeNoteV1: working hypothesis → immediate plan → presenting concerns.
  if (typeof c['presentingConcerns'] === 'string') {
    return firstLine(
      str(c['workingHypothesis']) || str(c['immediatePlan']) || str(c['presentingConcerns']),
    );
  }
  return null;
}

function deriveCarryoverRisk(content: unknown): CaseThreadRisk | null {
  if (!content || typeof content !== 'object') return null;
  const flags = (content as Record<string, unknown>)['riskFlags'];
  if (!flags || typeof flags !== 'object') return null;
  const f = flags as Record<string, unknown>;
  const severity = str(f['severity']).toLowerCase();
  if (
    severity !== 'low' &&
    severity !== 'medium' &&
    severity !== 'high' &&
    severity !== 'critical'
  ) {
    return null;
  }
  const indicators = Array.isArray(f['indicators'])
    ? (f['indicators'] as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim())
    : [];
  const items = indicators.length > 0 ? indicators.slice(0, 3) : compact([str(f['details'])]);
  if (items.length === 0) return null;
  return { severity, items };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function compact(arr: string[]): string[] {
  return arr.filter((s) => s.length > 0);
}

/**
 * The lead sentence/line of a note field, capped so the recap stays a
 * one-liner. Cuts at the first sentence boundary when there is one.
 */
function firstLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstPara = trimmed.split(/\n+/)[0]!.trim();
  const sentenceEnd = firstPara.search(/[.!?](\s|$)/);
  const candidate =
    sentenceEnd >= 0 && sentenceEnd < 200 ? firstPara.slice(0, sentenceEnd + 1) : firstPara;
  return candidate.length > 220 ? `${candidate.slice(0, 217).trimEnd()}…` : candidate;
}
