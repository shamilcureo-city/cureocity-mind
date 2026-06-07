import { INSTRUMENTS, computeInstrumentChange, type InstrumentKey } from '@cureocity/clinical';
import {
  type ChangeVerdict,
  type InstrumentChange,
  type ProgressReportInstrumentEntry,
  type ProgressReportSnapshot,
} from '@cureocity/contracts';
import { prisma } from './prisma';

/**
 * Sprint 20 — Client-facing Progress Report builder.
 *
 * Produces a plain-language ProgressReportSnapshot from cumulative
 * tables (InstrumentResponse for PHQ-9 / GAD-7 + the active
 * TreatmentPlan). Deterministic — no LLM call. Thresholds + verdicts
 * come from the Phase 1 reliable-change engine.
 *
 * The headline + encouragements adapt to the overall verdict so the
 * client gets a result that's both honest and supportive:
 *   - improving  → celebratory
 *   - mixed      → balanced
 *   - stable     → honest, plan-forward
 *   - worsening  → soft, plan-forward (never blame the client)
 *
 * Build failures throw `ProgressReportError`; the route surfaces them
 * as 422. Cross-tenant access is rejected before we get here, so this
 * function trusts (clientId, psychologistId).
 */

const TRACKED_INSTRUMENTS: InstrumentKey[] = ['PHQ9', 'GAD7'];

export class ProgressReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressReportError';
  }
}

export interface BuildProgressReportArgs {
  clientId: string;
  psychologistId: string;
  /** Optional therapist intro shown above the report in the portal. */
  intro?: string | null;
}

export interface ProgressReportBuildResult {
  snapshot: ProgressReportSnapshot;
  /** Number of instrument administrations that produced a verdict. */
  measuredInstrumentCount: number;
  /** Headline shown on the share row / WhatsApp / email subject line. */
  subject: string;
}

export async function buildProgressReport(
  args: BuildProgressReportArgs,
): Promise<ProgressReportBuildResult> {
  const client = await prisma.client.findUnique({
    where: { id: args.clientId },
    select: {
      psychologistId: true,
      deletedAt: true,
      fullName: true,
    },
  });
  if (!client || client.deletedAt !== null) {
    throw new ProgressReportError('Client not found');
  }
  if (client.psychologistId !== args.psychologistId) {
    throw new ProgressReportError('Client not owned by this psychologist');
  }

  const [completedCount, firstSession, instrumentRows, activePlanRow] = await Promise.all([
    prisma.session.count({ where: { clientId: args.clientId, status: 'COMPLETED' } }),
    prisma.session.findFirst({
      where: { clientId: args.clientId, status: 'COMPLETED' },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
    prisma.instrumentResponse.findMany({
      where: { clientId: args.clientId, instrumentKey: { in: TRACKED_INSTRUMENTS } },
      orderBy: { administeredAt: 'asc' },
      select: { instrumentKey: true, score: true, administeredAt: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId: args.clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { body: true },
    }),
  ]);

  const entries = buildInstrumentEntries(instrumentRows);
  if (entries.length === 0) {
    throw new ProgressReportError(
      'No comparable instrument administrations yet. Administer PHQ-9 or GAD-7 at least twice before sharing a progress report.',
    );
  }

  const overall = overallVerdict(entries.map((e) => e.change.verdict));
  const headline = headlineFor(overall, entries);
  const encouragements = encouragementsFor(overall);
  const goals = readPlanGoals(activePlanRow?.body);

  const snapshot: ProgressReportSnapshot = {
    kind: 'PROGRESS_REPORT',
    headline,
    intro: args.intro?.trim() ? args.intro.trim() : null,
    sessionsCompleted: completedCount,
    startedAt: firstSession?.scheduledAt.toISOString() ?? null,
    instruments: entries,
    goals,
    encouragements,
  };
  const subject = `Your progress · ${formatClientFirstName(client.fullName)}`.slice(0, 120);
  return { snapshot, measuredInstrumentCount: entries.length, subject };
}

// ============================================================================
// Per-instrument entry — narrative + verdict chip.
// ============================================================================

function buildInstrumentEntries(
  rows: { instrumentKey: string; score: number; administeredAt: Date }[],
): ProgressReportInstrumentEntry[] {
  const out: ProgressReportInstrumentEntry[] = [];
  for (const key of TRACKED_INSTRUMENTS) {
    const series = rows.filter((r) => r.instrumentKey === key);
    if (series.length < 2) continue;
    const baseline = series[0]!;
    const latest = series[series.length - 1]!;
    const change = computeInstrumentChange(key, baseline.score, latest.score);
    const wrapped: InstrumentChange = {
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
    };
    out.push({
      label: INSTRUMENT_LABEL[key],
      narrative: composeNarrative(key, wrapped),
      verdictChip: verdictChip(wrapped.verdict),
      change: wrapped,
    });
  }
  return out;
}

const INSTRUMENT_LABEL: Record<InstrumentKey, string> = {
  PHQ9: 'Depression (PHQ-9)',
  GAD7: 'Anxiety (GAD-7)',
};

const VERDICT_CHIP: Record<ChangeVerdict, string> = {
  reliable_improvement: 'Real improvement',
  no_reliable_change: 'About the same',
  deterioration: 'Getting harder',
};

function verdictChip(v: ChangeVerdict): string {
  return VERDICT_CHIP[v];
}

function composeNarrative(key: InstrumentKey, change: InstrumentChange): string {
  const concept = key === 'PHQ9' ? 'depression' : 'anxiety';
  const baselineWord = severityWord(key, change.baselineSeverityKey);
  const latestWord = severityWord(key, change.latestSeverityKey);
  const baselineSentence = `When we started, your ${concept} score was ${change.baselineScore} — ${baselineWord}.`;
  const latestSentence = `Today it's ${change.latestScore} — ${latestWord}.`;

  let verdictSentence: string;
  switch (change.verdict) {
    case 'reliable_improvement':
      verdictSentence = change.isRemission
        ? 'That is a meaningful change — your symptoms are now in the everyday range.'
        : `That is a meaningful improvement (about ${formatPercent(change.percentChange)} lower).`;
      break;
    case 'no_reliable_change':
      verdictSentence = change.isRemission
        ? `Your scores are holding steady in the lower range — that's a sign things are settled, not stuck.`
        : `Your scores are about the same — change in therapy is rarely linear, and steady is its own kind of progress.`;
      break;
    case 'deterioration':
      verdictSentence = `Things have been a bit heavier lately. We'll talk this through together — this is information, not a verdict.`;
      break;
  }
  return [baselineSentence, latestSentence, verdictSentence].join(' ');
}

function severityWord(key: InstrumentKey, severityKey: string): string {
  const band = INSTRUMENTS[key].severityBands.find((b) => b.key === severityKey);
  return band?.label.en.toLowerCase() ?? severityKey.replace(/_/g, ' ');
}

function formatPercent(percentChange: number | null): string {
  if (percentChange === null || !Number.isFinite(percentChange)) return 'meaningfully';
  return `${Math.round(Math.abs(percentChange))}%`;
}

// ============================================================================
// Headline + encouragements adapt to the overall verdict.
// ============================================================================

type Overall = 'improving' | 'stable' | 'worsening' | 'mixed';

function overallVerdict(verdicts: ChangeVerdict[]): Overall {
  const hasImprove = verdicts.includes('reliable_improvement');
  const hasWorsen = verdicts.includes('deterioration');
  if (hasImprove && !hasWorsen) return 'improving';
  if (hasWorsen && !hasImprove) return 'worsening';
  if (hasImprove && hasWorsen) return 'mixed';
  return 'stable';
}

function headlineFor(verdict: Overall, entries: ProgressReportInstrumentEntry[]): string {
  switch (verdict) {
    case 'improving': {
      // Highlight the strongest improvement.
      const best = entries
        .filter((e) => e.change.verdict === 'reliable_improvement')
        .sort((a, b) => (a.change.percentChange ?? 0) - (b.change.percentChange ?? 0))[0];
      if (best && best.change.percentChange !== null) {
        const word = best.change.instrumentKey === 'PHQ9' ? 'depression' : 'anxiety';
        return `Your ${word} score has come down by ${Math.round(Math.abs(best.change.percentChange))}% since we started.`;
      }
      return 'There has been real, measurable progress since we started.';
    }
    case 'mixed':
      return 'Some things are clearly improving; others are still settling. Both are part of the work.';
    case 'stable':
      return 'Steady is its own kind of progress — your scores have held where they are.';
    case 'worsening':
      return 'Things have been heavier lately. Bringing this into the room is exactly why we measure.';
  }
}

function encouragementsFor(verdict: Overall): string[] {
  switch (verdict) {
    case 'improving':
      return [
        'The work you have put in between sessions is showing up in the numbers.',
        'Keep going — small, steady practice between sessions is what makes change durable.',
        'Bring anything that has helped most into our next session so we can build on it.',
      ];
    case 'mixed':
      return [
        'Therapy rarely changes everything at once — uneven progress is normal.',
        "We will use what is improving to lift what isn't.",
        'Notice what felt different on the better days — those moments are the data we work from.',
      ];
    case 'stable':
      return [
        'Holding steady through a hard time is harder than it looks.',
        'We can use our next sessions to focus on one thing you want to shift.',
        'Keep noting the moments that feel lighter — they show where to push next.',
      ];
    case 'worsening':
      return [
        'A harder stretch does not mean therapy is not working — it usually means the work just shifted.',
        'You are not in this alone; bring whatever felt heaviest into our next session.',
        'If you ever feel unsafe, call iCall on 9152987821 or NIMHANS on 080-46110007.',
      ];
  }
}

// ============================================================================
// Helpers.
// ============================================================================

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

function formatClientFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return 'you';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
