import { computeInstrumentChange, type InstrumentKey } from '@cureocity/clinical';
import type {
  InstrumentChange,
  JourneyActivePlan,
  JourneyEpisode,
  JourneyStage,
  JourneySummary,
  JourneyWorkingDiagnosis,
  NextBestAction,
  SessionModality,
} from '@cureocity/contracts';
import { prisma } from './prisma';

/**
 * Sprint 20 — client therapy-journey composer (measurement-based care).
 *
 * Derives the per-client arc from the cumulative tables — no new storage.
 * Both the Journey hub on the client detail page and
 * GET /api/v1/clients/[id]/journey call this. Mirrors the ownership +
 * error shape of `session-defaults.ts`.
 *
 * Stage:
 *   INTAKE           — no completed session yet
 *   ASSESSMENT       — ≥1 completed session, no active treatment plan
 *   ACTIVE_TREATMENT — active (non-superseded) plan exists
 *   REVIEW_DUE       — active plan aged ≥8 completed sessions
 *   DISCHARGE_READY  — instrument remission reached on a plan
 */

const TRACKED_INSTRUMENTS: InstrumentKey[] = ['PHQ9', 'GAD7'];
/** Completed sessions since plan confirmation that trigger a re-eval. */
const REVIEW_THRESHOLD_SESSIONS = 8;
/** Administrations needed before a flat trend is "not improving". */
const NOT_IMPROVING_MIN_ADMINISTRATIONS = 3;

export class JourneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyError';
  }
}

export async function computeClientJourney(
  clientId: string,
  psychologistId: string,
): Promise<JourneySummary> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null) {
    throw new JourneyError('Client not found');
  }
  if (client.psychologistId !== psychologistId) {
    throw new JourneyError('Client not owned by this psychologist');
  }

  const [
    completedCount,
    lastSession,
    primaryDiagnosis,
    activePlanRow,
    instrumentRows,
    latestEpisode,
  ] = await Promise.all([
    prisma.session.count({ where: { clientId, status: 'COMPLETED' } }),
    prisma.session.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { scheduledAt: 'desc' },
      select: { id: true, scheduledAt: true, endedAt: true },
    }),
    prisma.clientDiagnosis.findFirst({
      where: { clientId, supersededAt: null, isPrimary: true },
      orderBy: { confirmedAt: 'desc' },
      select: { icd11Code: true, icd11Label: true, confidence: true, confirmedAt: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        body: true,
        confirmedAt: true,
        goalProgress: { select: { goalIndex: true, status: true } },
      },
    }),
    prisma.instrumentResponse.findMany({
      where: { clientId, instrumentKey: { in: TRACKED_INSTRUMENTS } },
      // CLIN-5 — secondary sort so same-timestamp duplicate administrations
      // pick a deterministic baseline/latest instead of an arbitrary one.
      orderBy: [{ administeredAt: 'asc' }, { createdAt: 'asc' }],
      select: { instrumentKey: true, score: true, administeredAt: true },
    }),
    prisma.treatmentEpisode.findFirst({
      where: { clientId },
      orderBy: { openedAt: 'desc' },
      select: { status: true, openedAt: true, closedAt: true, closeReason: true },
    }),
  ]);

  // CLIN-5 — bound the instrument series to the CURRENT episode. The baseline
  // is series[0]; without this bound a discharged client who relapses and
  // returns compares their new score against the PREVIOUS episode's baseline
  // and can show "remission reached — consider discharge" on their first
  // session back. Fall back to all-time only for pre-episode clients.
  const episodeScoped = latestEpisode
    ? instrumentRows.filter((r) => r.administeredAt >= latestEpisode.openedAt)
    : instrumentRows;

  // Per-instrument reliable-change verdicts (only where ≥2 administrations).
  const instrumentChanges = buildInstrumentChanges(episodeScoped);

  // Sprint 20 Phase 3 — a closed episode makes the arc terminal, UNLESS
  // the client has come back (a completed session after the close).
  const closedEpisode = resolveClosedEpisode(latestEpisode, lastSession?.endedAt ?? null);
  const isDischarged = closedEpisode !== null;

  // Sessions completed since the active plan was confirmed → review cadence.
  let sessionsSincePlan = 0;
  if (activePlanRow) {
    sessionsSincePlan = await prisma.session.count({
      where: {
        clientId,
        status: 'COMPLETED',
        endedAt: { gte: activePlanRow.confirmedAt },
      },
    });
  }

  const dischargeReady = instrumentChanges.some(
    (c) => c.isRemission && (c.verdict === 'reliable_improvement' || c.isResponse),
  );

  const workingDiagnosis: JourneyWorkingDiagnosis | null = primaryDiagnosis
    ? {
        icd11Code: primaryDiagnosis.icd11Code,
        icd11Label: primaryDiagnosis.icd11Label,
        confidence: primaryDiagnosis.confidence,
        confirmedAt: primaryDiagnosis.confirmedAt.toISOString(),
      }
    : null;

  const activePlan: JourneyActivePlan | null = activePlanRow
    ? buildActivePlan(activePlanRow)
    : null;

  const stage: JourneyStage = isDischarged
    ? 'DISCHARGED'
    : deriveStage({
        completedCount,
        hasActivePlan: activePlanRow !== null,
        sessionsSincePlan,
        dischargeReady,
      });

  const nextBestAction = isDischarged
    ? dischargedAction(clientId, instrumentChanges.length > 0)
    : deriveNextBestAction({
        clientId,
        lastCompletedSessionId: lastSession?.id ?? null,
        stage,
        completedCount,
        hasInstruments: instrumentRows.length > 0,
        hasPrimaryDiagnosis: primaryDiagnosis !== null,
        hasActivePlan: activePlanRow !== null,
        instrumentChanges,
        dischargeReady,
      });

  return {
    clientId,
    stage,
    sessionsCompleted: completedCount,
    lastSessionAt: lastSession?.scheduledAt.toISOString() ?? null,
    workingDiagnosis,
    activePlan,
    instrumentChanges,
    nextBestAction,
    closedEpisode,
  };
}

/**
 * A terminal episode marks the arc DISCHARGED only if no completed
 * session happened after it closed (otherwise the client returned and
 * a fresh OPEN episode should exist).
 */
function resolveClosedEpisode(
  episode: { status: string; closedAt: Date | null; closeReason: string | null } | null,
  lastEndedAt: Date | null,
): JourneyEpisode | null {
  if (!episode || episode.status === 'OPEN' || episode.closedAt === null) return null;
  if (lastEndedAt && lastEndedAt.getTime() > episode.closedAt.getTime()) return null;
  if (episode.status !== 'DISCHARGED' && episode.status !== 'TRANSFERRED') return null;
  return {
    status: episode.status,
    closedAt: episode.closedAt.toISOString(),
    closeReason: episode.closeReason,
  };
}

function dischargedAction(clientId: string, canShareReport: boolean): NextBestAction {
  return {
    kind: 'CONTINUE',
    tone: 'positive',
    title: 'Care episode closed',
    detail: canShareReport
      ? 'This episode of care is complete. Share a final outcome report so the client leaves with a record of their progress. Recording a new session reopens care.'
      : 'This episode of care is complete. Recording a new session reopens care.',
    ctaLabel: null,
    ctaHref: null,
  };
}

// ============================================================================
// Stage + action derivation (pure given the gathered inputs).
// ============================================================================

function deriveStage(input: {
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

function deriveNextBestAction(input: {
  clientId: string;
  /** Sprint 52 — fed to the not-improving CTA so it deep-links to the AI Copilot Briefing sub-tab. */
  lastCompletedSessionId: string | null;
  stage: JourneyStage;
  completedCount: number;
  hasInstruments: boolean;
  hasPrimaryDiagnosis: boolean;
  hasActivePlan: boolean;
  instrumentChanges: InstrumentChange[];
  dischargeReady: boolean;
}): NextBestAction | null {
  const instrumentsAnchor = `/app/clients/${input.clientId}#instruments`;

  // 1. No sessions yet — record the intake.
  if (input.completedCount === 0) {
    return {
      kind: 'CONTINUE',
      tone: 'info',
      title: 'Record the intake session',
      detail:
        'This client has no completed session yet. Record an intake to start the clinical picture.',
      ctaLabel: 'Go to Record',
      ctaHref: '/app',
    };
  }

  // 2. Baseline measurement is the foundation of measurement-based care.
  if (!input.hasInstruments) {
    return {
      kind: 'ADMINISTER_BASELINE',
      tone: 'info',
      title: 'Set a baseline — administer PHQ-9 + GAD-7',
      detail:
        'You can only show progress against a starting point. Administer the recommended screeners now so every later session measures change.',
      ctaLabel: 'Administer now',
      ctaHref: instrumentsAnchor,
    };
  }

  // 3. Discharge signal takes priority over routine continuation.
  if (input.dischargeReady) {
    return {
      kind: 'CONSIDER_DISCHARGE',
      tone: 'positive',
      title: 'Remission reached — consider discharge',
      detail:
        'The latest screener is in the remission range with a reliable improvement from baseline. Review goals and plan an outcome summary for the client.',
      ctaLabel: null,
      ctaHref: null,
    };
  }

  // 4. Not-on-track alert — the highest-value MBC signal.
  const stalled = input.instrumentChanges.find(
    (c) =>
      c.administrationCount >= NOT_IMPROVING_MIN_ADMINISTRATIONS &&
      c.verdict !== 'reliable_improvement',
  );
  if (input.hasActivePlan && stalled) {
    // Sprint 52 → TSC-V2 — link the "not improving" action to the Case
    // Consult, now in the Journey page's "story so far" section. That's
    // the exact "I'm stuck" moment the consult was built for.
    const consultHref = input.lastCompletedSessionId
      ? `/app/sessions/${input.lastCompletedSessionId}?tab=copilot&sub=journey`
      : null;
    return {
      kind: 'REVIEW_PLAN_NOT_IMPROVING',
      tone: 'warn',
      title: 'Not improving as expected — review the plan',
      detail: `${stalled.instrumentKey} has shown no reliable improvement across ${stalled.administrationCount} administrations. Clients who aren't on track benefit most from an early change of course — revisit the formulation or step up the plan.`,
      ctaLabel: consultHref ? 'Get a case consult' : null,
      ctaHref: consultHref,
    };
  }

  // 5. Confirmed diagnosis but no plan → confirm one.
  if (input.hasPrimaryDiagnosis && !input.hasActivePlan) {
    return {
      kind: 'CONFIRM_PLAN',
      tone: 'info',
      title: 'Confirm a treatment plan',
      detail:
        'A primary diagnosis is on record but there is no active treatment plan. Confirm one from the Clinical Brief so the next sessions have a structure.',
      ctaLabel: null,
      ctaHref: null,
    };
  }

  // 6. Assessment in progress — close the gaps to reach a diagnosis.
  if (!input.hasActivePlan && !input.hasPrimaryDiagnosis) {
    return {
      kind: 'BOOK_ASSESSMENT',
      tone: 'info',
      title: 'Continue the assessment',
      detail:
        'No diagnosis is confirmed yet. Run an assessment session to close the open questions, then confirm a primary diagnosis from the Clinical Brief.',
      ctaLabel: 'Go to Record',
      ctaHref: '/app',
    };
  }

  // 7. On track — nothing to nudge.
  return {
    kind: 'CONTINUE',
    tone: 'positive',
    title: 'On track',
    detail:
      'Continue with the current plan. Re-administer screeners every few sessions to keep the trend live.',
    ctaLabel: null,
    ctaHref: null,
  };
}

// ============================================================================
// Helpers.
// ============================================================================

function buildInstrumentChanges(
  rows: { instrumentKey: string; score: number; administeredAt: Date }[],
): InstrumentChange[] {
  const out: InstrumentChange[] = [];
  for (const key of TRACKED_INSTRUMENTS) {
    const series = rows.filter((r) => r.instrumentKey === key);
    if (series.length < 2) continue;
    const baseline = series[0]!;
    const latest = series[series.length - 1]!;
    const change = computeInstrumentChange(key, baseline.score, latest.score);
    out.push({
      instrumentKey: key,
      baselineScore: baseline.score,
      latestScore: latest.score,
      delta: change.delta,
      percentChange: change.percentChange,
      verdict: change.verdict,
      isResponse: change.isResponse,
      isRemission: change.isRemission,
      baselineSeverityKey: change.baselineSeverityKey,
      latestSeverityKey: change.latestSeverityKey,
      administrationCount: series.length,
      baselineAt: baseline.administeredAt.toISOString(),
      latestAt: latest.administeredAt.toISOString(),
    });
  }
  return out;
}

function readPlanModality(body: unknown): SessionModality | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { modality?: string }).modality;
  if (typeof raw !== 'string') return null;
  switch (raw.toUpperCase()) {
    case 'CBT':
      return 'CBT';
    case 'EMDR':
      return 'EMDR';
    case 'ACT':
      return 'ACT';
    case 'IFS':
      return 'IFS';
    case 'PSYCHODYNAMIC':
      return 'PSYCHODYNAMIC';
    case 'MI':
      return 'MI';
    case 'MBCT':
      return 'MBCT';
    case 'SUPPORTIVE':
      return 'SUPPORTIVE';
    case 'OTHER':
    case 'MIXED':
      return 'OTHER';
    default:
      return null;
  }
}

function buildActivePlan(row: {
  id: string;
  version: number;
  body: unknown;
  confirmedAt: Date;
  goalProgress: { goalIndex: number; status: 'NOT_STARTED' | 'IN_PROGRESS' | 'ACHIEVED' }[];
}): JourneyActivePlan {
  const statusByIndex = new Map(row.goalProgress.map((g) => [g.goalIndex, g.status]));
  const rawGoals = readPlanGoals(row.body);
  const goals = rawGoals.map((g, index) => ({
    index,
    description: g.description,
    measure: g.measure,
    status: statusByIndex.get(index) ?? ('NOT_STARTED' as const),
  }));
  return {
    id: row.id,
    version: row.version,
    modality: readPlanModality(row.body),
    goals,
    goalsAchieved: goals.filter((g) => g.status === 'ACHIEVED').length,
    goalsTotal: goals.length,
    confirmedAt: row.confirmedAt.toISOString(),
  };
}

function readPlanGoals(body: unknown): { description: string; measure: string }[] {
  if (!body || typeof body !== 'object') return [];
  const goals = (body as { goals?: unknown }).goals;
  if (!Array.isArray(goals)) return [];
  return goals
    .filter(
      (g): g is { description: string; measure: string } =>
        !!g &&
        typeof g === 'object' &&
        typeof (g as { description?: unknown }).description === 'string' &&
        typeof (g as { measure?: unknown }).measure === 'string',
    )
    .map((g) => ({ description: g.description, measure: g.measure }));
}
