import {
  computeCareEngine,
  type CareEngineInput,
  type CareEngineInstrument,
  type InstrumentKey,
} from '@cureocity/clinical';
import type { CareEngineV1 } from '@cureocity/contracts';
import { computeClientJourney, JourneyError } from './journey';
import { fetchOpenCrises } from './crisis-flags';
import { prisma } from './prisma';

/** ICD/kind → human label for the crisis rail (shared with the case briefing). */
const CRISIS_LABEL: Record<string, string> = {
  suicidal_ideation: 'suicidal ideation',
  suicidal_plan: 'suicidal plan',
  harm_to_others: 'harm to others',
  child_safety: 'child safety',
  intimate_partner_violence: 'intimate-partner violence',
  psychosis: 'possible psychosis',
  substance_emergency: 'substance emergency',
  other: 'unrecognised risk',
};

/**
 * Sprint JE2 — the Care Engine compose layer.
 *
 * Assembles the normalised `CareEngineInput` from the cumulative record and
 * runs the pure `computeCareEngine` (packages/clinical). This is the single
 * thing the Journey page reads — replacing the five stitched components and
 * their two competing action engines.
 *
 * It reuses `computeClientJourney` (for the ownership check, the instrument
 * verdicts, the active plan and the working diagnosis) and adds the inputs
 * the old journey composer never read: the open crisis + safety plan (the
 * SAFETY gate/action), per-instrument administration counts + dates (baseline
 * vs re-measure cadence), the running assessment items (the ranked question
 * queue), and the next booked session. Re-throws `JourneyError` so the page's
 * existing catch keeps working.
 */

const TRACKED: InstrumentKey[] = ['PHQ9', 'GAD7'];

export async function computeCareEngineForClient(
  clientId: string,
  psychologistId: string,
  sessionId: string | null,
): Promise<CareEngineV1> {
  // computeClientJourney owns the ownership check + the reliable-change
  // verdicts + the active plan / working diagnosis. Reuse it wholesale.
  const journey = await computeClientJourney(clientId, psychologistId);

  const [latestEpisode, instrumentRows, openCrises, safetyPlan, openItems, nextScheduled] =
    await Promise.all([
      prisma.treatmentEpisode.findFirst({
        where: { clientId },
        orderBy: { openedAt: 'desc' },
        select: { openedAt: true },
      }),
      prisma.instrumentResponse.findMany({
        where: { clientId, instrumentKey: { in: TRACKED } },
        orderBy: [{ administeredAt: 'asc' }, { createdAt: 'asc' }],
        select: { instrumentKey: true, administeredAt: true },
      }),
      // High/critical open crisis flags across recent reports (the SAFETY signal).
      fetchOpenCrises(clientId),
      prisma.safetyPlan.findFirst({
        where: { clientId, supersededAt: null },
        select: { id: true },
      }),
      prisma.assessmentItem.findMany({
        where: { clientId, status: { in: ['OPEN', 'ADDRESSED'] } },
        orderBy: { createdAt: 'asc' },
        take: 40,
        select: {
          id: true,
          kind: true,
          question: true,
          rationale: true,
          icd11Code: true,
          createdAt: true,
        },
      }),
      // The next booked future session (SCHEDULED), for the "next session" line.
      prisma.session.findFirst({
        where: { clientId, status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
    ]);

  // Episode-scope the instrument admin counts (matches the journey's verdicts).
  const scopedRows = latestEpisode
    ? instrumentRows.filter((r) => r.administeredAt >= latestEpisode.openedAt)
    : instrumentRows;

  const instruments: CareEngineInstrument[] = TRACKED.map((key) => {
    const series = scopedRows.filter((r) => r.instrumentKey === key);
    const change = journey.instrumentChanges.find((c) => c.instrumentKey === key) ?? null;
    return {
      key,
      count: series.length,
      lastAt: series.length > 0 ? series[series.length - 1]!.administeredAt.toISOString() : null,
      change,
    };
  });

  // Completed-session end-times (newest first) drive question staleness.
  const completedSessions = await prisma.session.findMany({
    where: { clientId, status: 'COMPLETED', endedAt: { not: null } },
    orderBy: { endedAt: 'desc' },
    select: { endedAt: true },
  });
  const completedSessionEndedAts = completedSessions
    .map((s) => s.endedAt?.toISOString())
    .filter((v): v is string => typeof v === 'string');

  // sessionsSincePlan: completed sessions since the active plan was confirmed.
  let sessionsSincePlan = 0;
  if (journey.activePlan) {
    sessionsSincePlan = await prisma.session.count({
      where: {
        clientId,
        status: 'COMPLETED',
        endedAt: { gte: new Date(journey.activePlan.confirmedAt) },
      },
    });
  }

  // fetchOpenCrises only returns high/critical flags, deduped by kind.
  const crisis = {
    highestSeverity: (openCrises.some((c) => c.severity === 'critical')
      ? 'critical'
      : openCrises.length > 0
        ? 'high'
        : 'none') as 'none' | 'low' | 'medium' | 'high' | 'critical',
    labels: openCrises.map((c) => CRISIS_LABEL[c.kind] ?? c.kind),
  };

  const journeySub = sessionId ? `/app/sessions/${sessionId}?tab=copilot&sub=journey` : null;
  const sessionSub = sessionId ? `/app/sessions/${sessionId}?tab=copilot&sub=session` : null;

  const input: CareEngineInput = {
    clientId,
    now: new Date().toISOString(),
    sessionsCompleted: journey.sessionsCompleted,
    lastSessionAt: journey.lastSessionAt,
    nextSessionAt: nextScheduled?.scheduledAt.toISOString() ?? null,
    completedSessionEndedAts,
    lastCompletedSessionId: sessionId,
    workingDiagnosis: journey.workingDiagnosis,
    activePlan: journey.activePlan,
    sessionsSincePlan,
    instruments,
    crisis,
    hasSafetyPlan: safetyPlan !== null,
    discharged: journey.closedEpisode,
    openQuestions: openItems.map((i) => ({
      id: i.id,
      kind: i.kind,
      question: i.question,
      rationale: i.rationale,
      icd11Code: i.icd11Code,
      createdAt: i.createdAt.toISOString(),
    })),
    hrefs: { journeySub, sessionSub },
  };

  return computeCareEngine(input);
}

export { JourneyError };
