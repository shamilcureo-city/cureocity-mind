import {
  ClinicalReportV1Schema,
  InitialAssessmentBriefV1Schema,
  IntakeNoteV1Schema,
  type CaseBriefingAction,
  type CaseBriefingV1,
  type CaseBriefingWhen,
  type FivePFormulation,
  type JourneySummary,
} from '@cureocity/contracts';
import { computeClientJourney } from './journey';
import { prisma } from './prisma';
import {
  fetchClinicianDocumentedRisk,
  withClinicianRisk,
  type ClinicianDocumentedRisk,
} from './clinician-documented-risk';

/**
 * Sprint 22 — deterministic Case Briefing builder.
 *
 * Composes the single synthesis at the centre of the Case Workspace
 * from cumulative state, reusing the journey composer for stage +
 * instrument verdicts. This is the guaranteed fallback: Pass 6 layers an
 * LLM narrative on top, but if GCP is unavailable (dev / mock / outage)
 * this still answers the four questions deterministically.
 */

export interface CaseBriefingInputs {
  journey: JourneySummary;
  openItems: {
    id: string;
    kind: 'DIAGNOSTIC_CRITERION' | 'ASSESSMENT_GAP' | 'INSTRUMENT' | 'SAFETY';
    question: string;
    rationale: string;
    icd11Code: string | null;
  }[];
  presentingConcerns: string | null;
  intakeNote: ReturnType<typeof parseIntake>;
  latestReportBody: unknown;
  hasSafetyPlan: boolean;
  clinicianDocumentedRisk?: ClinicianDocumentedRisk | null;
  clientId: string;
  /** Sprint 75 — active problem list + how many sessions worked on each. */
  problems: { title: string; sessionCount: number }[];
  /** Sprint 75 — full per-instrument score trajectory (compact). */
  instrumentSeries: { instrumentKey: string; points: { score: number; at: Date }[] }[];
  /** Sprint 75 — superseded diagnoses, so the formulation's evolution is visible. */
  diagnosisHistory: {
    icd11Code: string;
    icd11Label: string;
    confirmedAt: Date;
    supersededAt: Date | null;
  }[];
}

export async function buildDeterministicCaseBriefing(
  clientId: string,
  psychologistId: string,
): Promise<CaseBriefingV1> {
  const inputs = await gatherInputs(clientId, psychologistId);
  return composeBriefing(inputs);
}

/** Gather everything the briefing reads. Exposed so Pass 6 reuses it. */
export async function gatherInputs(
  clientId: string,
  psychologistId: string,
): Promise<CaseBriefingInputs> {
  const journey = await computeClientJourney(clientId, psychologistId);

  const [
    openItemRows,
    client,
    latestReport,
    latestIntakeDraft,
    safetyPlan,
    problemRows,
    instrumentRows,
    diagnosisRows,
    clinicianDocumentedRisk,
  ] = await Promise.all([
    prisma.assessmentItem.findMany({
      where: { clientId, status: { in: ['OPEN', 'ADDRESSED'] } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 40,
      select: { id: true, kind: true, question: true, rationale: true, icd11Code: true },
    }),
    prisma.client.findUnique({
      where: { id: clientId },
      select: { presentingConcerns: true },
    }),
    prisma.clinicalReport.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
    prisma.session.findFirst({
      where: { clientId, kind: 'INTAKE' },
      orderBy: { scheduledAt: 'desc' },
      select: { noteDraft: { select: { content: true } } },
    }),
    prisma.safetyPlan.findFirst({
      where: { clientId, supersededAt: null },
      select: { id: true },
    }),
    // Sprint 75 — the maintained problem list + session-thread counts.
    prisma.problemListItem.findMany({
      where: { clientId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { title: true, _count: { select: { sessionLinks: true } } },
    }),
    // Sprint 75 — full instrument trajectory (not just baseline → latest).
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: { administeredAt: 'asc' },
      take: 60,
      select: { instrumentKey: true, score: true, administeredAt: true },
    }),
    // Sprint 75 — diagnosis evolution, superseded entries included.
    prisma.clientDiagnosis.findMany({
      where: { clientId },
      orderBy: { confirmedAt: 'desc' },
      take: 8,
      select: { icd11Code: true, icd11Label: true, confirmedAt: true, supersededAt: true },
    }),
    fetchClinicianDocumentedRisk(clientId, psychologistId),
  ]);

  const seriesByKey = new Map<string, { score: number; at: Date }[]>();
  for (const r of instrumentRows) {
    const arr = seriesByKey.get(r.instrumentKey) ?? [];
    arr.push({ score: r.score, at: r.administeredAt });
    seriesByKey.set(r.instrumentKey, arr);
  }

  return {
    journey,
    openItems: openItemRows,
    presentingConcerns: client?.presentingConcerns ?? null,
    intakeNote: parseIntake(latestIntakeDraft?.noteDraft?.content),
    latestReportBody: latestReport?.body ?? null,
    hasSafetyPlan: safetyPlan !== null,
    clinicianDocumentedRisk,
    clientId,
    problems: problemRows.map((p) => ({ title: p.title, sessionCount: p._count.sessionLinks })),
    instrumentSeries: [...seriesByKey.entries()].map(([instrumentKey, points]) => ({
      instrumentKey,
      points,
    })),
    diagnosisHistory: diagnosisRows,
  };
}

function parseIntake(content: unknown) {
  if (!content) return null;
  const parsed = IntakeNoteV1Schema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

/**
 * Compact text dump of the cumulative record — THE case digest.
 * Used as the `contextText` for Pass 6 (case briefing), Pass 7
 * (conceptual map) and Pass 8 (case consult), and — Sprint 75 — as
 * `caseDigest` for Pass 3 (clinical analysis), which previously saw
 * almost no longitudinal state. Lifted out of the case-briefing route
 * in Sprint 52 so every consumer shares one format and one source of
 * truth; enriched in Sprint 75 with the problem threads, the full
 * instrument trajectory, and the diagnosis evolution.
 */
export function serialiseContext(inputs: CaseBriefingInputs): string {
  const j = inputs.journey;
  const lines: string[] = [];
  lines.push(`Stage: ${j.stage}`);
  lines.push(`Completed sessions: ${j.sessionsCompleted}`);
  if (j.workingDiagnosis) {
    lines.push(
      `Confirmed diagnosis: ${j.workingDiagnosis.icd11Code} ${j.workingDiagnosis.icd11Label} (confidence ${j.workingDiagnosis.confidence})`,
    );
  }
  const superseded = inputs.diagnosisHistory.filter((d) => d.supersededAt !== null);
  if (superseded.length > 0) {
    lines.push('Diagnosis history (superseded — how the formulation evolved):');
    for (const d of superseded) {
      lines.push(
        `  - ${d.icd11Code} ${d.icd11Label} (held ${isoDay(d.confirmedAt)} → ${isoDay(d.supersededAt!)})`,
      );
    }
  }
  if (j.activePlan) {
    lines.push(
      `Active plan v${j.activePlan.version} (${j.activePlan.modality ?? 'modality TBD'}); goals ${j.activePlan.goalsAchieved}/${j.activePlan.goalsTotal} achieved:`,
    );
    for (const g of j.activePlan.goals) lines.push(`  - [${g.status}] ${g.description}`);
  }
  if (j.instrumentChanges.length > 0) {
    lines.push('Instrument verdicts (deterministic reliable-change engine):');
    for (const c of j.instrumentChanges) {
      lines.push(
        `  - ${c.instrumentKey}: ${c.baselineScore} → ${c.latestScore} (${c.verdict}${c.isRemission ? ', remission' : ''})`,
      );
    }
  }
  if (inputs.instrumentSeries.length > 0) {
    lines.push('Instrument trajectories (score@date, oldest first):');
    for (const s of inputs.instrumentSeries) {
      const pts = s.points.map((p) => `${p.score}@${isoDay(p.at)}`).join(', ');
      lines.push(`  - ${s.instrumentKey}: ${pts}`);
    }
  }
  if (inputs.problems.length > 0) {
    lines.push('Active problem list (therapist-maintained; sessions that worked on each):');
    for (const p of inputs.problems) {
      lines.push(
        `  - ${p.title} (worked on in ${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'})`,
      );
    }
  }
  if (inputs.presentingConcerns) lines.push(`Presenting concerns: ${inputs.presentingConcerns}`);
  if (inputs.intakeNote) {
    lines.push(
      `Intake — history of presenting illness: ${inputs.intakeNote.historyOfPresentingIllness}`,
    );
    lines.push(`Intake — working hypothesis: ${inputs.intakeNote.workingHypothesis}`);
    lines.push(`Intake — social history: ${inputs.intakeNote.socialHistory}`);
    lines.push(`Intake — family history: ${inputs.intakeNote.familyHistory}`);
  }
  if (inputs.openItems.length > 0) {
    lines.push('Open assessment items (the running differential):');
    for (const i of inputs.openItems) lines.push(`  - (${i.kind}) ${i.question} — ${i.rationale}`);
  }
  lines.push(`Safety plan on file: ${inputs.hasSafetyPlan ? 'yes' : 'no'}`);
  if (inputs.clinicianDocumentedRisk) {
    const risk = inputs.clinicianDocumentedRisk;
    lines.push(
      `Clinician-written ${risk.sourceStatus === 'UNFINISHED' ? 'unfinished draft' : 'note'} records ${risk.severity} risk (${risk.recordedAt}; source session ${risk.sourceSessionId}). Historical documentation requires review, not an AI-confirmed or current risk assessment.`,
    );
  }
  return lines.join('\n');
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function composeBriefing(inputs: CaseBriefingInputs): CaseBriefingV1 {
  const { journey } = inputs;
  const reportFormulation = readReportFormulation(inputs.latestReportBody);
  const crisis = withClinicianRisk(
    readCrisis(inputs.latestReportBody),
    inputs.clinicianDocumentedRisk,
  );

  const formulation = buildFivePs(inputs, reportFormulation);
  const headline = buildHeadline(journey, reportFormulation);

  // Only authored assessment items are open questions. A questionnaire is
  // optional clinical support, never a synthetic counselling prerequisite.
  const openItems = [...inputs.openItems];
  if (crisis.highestSeverity !== 'none' && !inputs.hasSafetyPlan) {
    openItems.unshift({
      id: 'synthetic-safety',
      kind: 'SAFETY',
      question: 'Review safety context with the client and agree appropriate support',
      rationale: 'Documented safety concerns need clinical review; no safety plan is on file.',
      icd11Code: null,
    });
  }

  const nextActions = buildNextActions(inputs, openItems, crisis);
  const cadence = buildCadence(journey);

  return {
    version: 'V1',
    headline,
    formulation,
    workingDiagnosis: journey.workingDiagnosis
      ? {
          icd11Code: journey.workingDiagnosis.icd11Code,
          icd11Label: journey.workingDiagnosis.icd11Label,
          confidence: journey.workingDiagnosis.confidence,
          confirmed: true,
        }
      : readTopDifferential(inputs.latestReportBody),
    openItems: openItems.map((i) => ({
      id: i.id,
      kind: i.kind,
      question: i.question,
      rationale: i.rationale,
      icd11Code: i.icd11Code,
    })),
    nextActions,
    cadence,
    safety: {
      highestSeverity: crisis.highestSeverity,
      openCrisisFlags: crisis.labels,
      hasSafetyPlan: inputs.hasSafetyPlan,
      clinicianDocumentedRisk: inputs.clinicianDocumentedRisk ?? null,
    },
    generatedAt: new Date().toISOString(),
    source: 'deterministic',
  };
}

// ============================================================================
// 5 Ps + headline.
// ============================================================================

function buildFivePs(
  inputs: CaseBriefingInputs,
  reportFormulation: string | null,
): FivePFormulation {
  const intake = inputs.intakeNote;
  const presenting =
    inputs.presentingConcerns?.trim() ||
    intake?.presentingConcerns?.trim() ||
    '(presenting concerns not yet recorded)';
  // Best-effort heuristic mapping from the intake note's standard
  // sections; Pass 6 produces the genuinely-reasoned version.
  const predisposing = compact(
    [intake?.familyHistory, intake?.socialHistory].filter(notElicited).join(' '),
  );
  const precipitating = compact(firstSentences(intake?.historyOfPresentingIllness, 2));
  const perpetuating = compact(reportFormulation ?? intake?.workingHypothesis ?? '');
  const protective = '(strengths + supports not yet documented)';
  return {
    presenting: clip(presenting, 1200),
    predisposing: clip(predisposing || '(predisposing factors not yet documented)', 1200),
    precipitating: clip(precipitating || '(precipitant not yet documented)', 1200),
    perpetuating: clip(perpetuating || '(maintaining factors not yet documented)', 1200),
    protective: clip(protective, 1200),
  };
}

function buildHeadline(journey: JourneySummary, reportFormulation: string | null): string {
  if (journey.workingDiagnosis) {
    return clip(
      `Working diagnosis: ${journey.workingDiagnosis.icd11Label}. ${reportFormulation ?? ''}`.trim(),
      800,
    );
  }
  if (reportFormulation) return clip(reportFormulation, 800);
  if (journey.activePlan)
    return 'Continue from the client’s priorities and agreed plan; review what is helping.';
  if (journey.sessionsCompleted === 0)
    return 'Begin with the client’s concerns, priorities and agreement about working together.';
  return 'Build a shared understanding and agree the next helpful step. A diagnosis is not required for counselling.';
}

// ============================================================================
// Next actions (deterministic, prioritised, max 3).
// ============================================================================

function buildNextActions(
  inputs: CaseBriefingInputs,
  openItems: CaseBriefingInputs['openItems'],
  crisis: ReturnType<typeof readCrisis>,
): CaseBriefingAction[] {
  const { journey } = inputs;
  const actions: CaseBriefingAction[] = [];
  const anchor = `/app/clients/${inputs.clientId}/journey#measure-phq9`;

  // 1. Safety always first.
  if (crisis.highestSeverity === 'high' || crisis.highestSeverity === 'critical') {
    actions.push({
      title: inputs.clinicianDocumentedRisk
        ? 'Review documented safety concerns with the client'
        : 'Address the active crisis flag',
      detail: `${inputs.clinicianDocumentedRisk ? 'Saved safety context requires clinical review' : 'Crisis indicators are present'} (${crisis.labels.join(', ')}). ${
        inputs.hasSafetyPlan
          ? 'Review the safety plan with the client.'
          : 'Complete a safety plan this session.'
      }`,
      why: 'Risk takes precedence over all other clinical work.',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // Worsening takes precedence over an improved score on another measure.
  const deteriorating = journey.instrumentChanges.find((c) => c.verdict === 'deterioration');
  if (deteriorating) {
    actions.push({
      title: 'Review worsening with the client',
      detail: `${deteriorating.instrumentKey} shows reliable deterioration, even if another measure improved. Explore the client’s experience, functioning and safety before agreeing any change of course.`,
      why: 'One improved score must not obscure a worsening concern.',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // Optional measurement supports, but never blocks, a counselling plan.
  if (journey.instrumentChanges.length === 0 && journey.sessionsCompleted > 0) {
    actions.push({
      title: 'Agree how to review progress together',
      detail:
        'Use the client’s goals, everyday functioning and feedback. A relevant questionnaire is optional when clinically useful; no baseline is required to continue counselling.',
      why: 'Progress includes the changes that matter to this client, not only scores.',
      when: 'this_session',
      ctaLabel: 'Optional questionnaires',
      ctaHref: anchor,
    });
  }

  // 3. Close the differential — surface the top open diagnostic question.
  const topDiagnostic = openItems.find((i) => i.kind === 'DIAGNOSTIC_CRITERION');
  if (actions.length < 3 && topDiagnostic && !journey.workingDiagnosis) {
    actions.push({
      title: 'Next session — close an open diagnostic question',
      detail: `Ask: "${topDiagnostic.question}"`,
      why: topDiagnostic.rationale,
      when: 'next_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // A shared plan may be useful with or without a diagnosis.
  if (actions.length < 3 && !journey.activePlan && journey.sessionsCompleted > 0) {
    actions.push({
      title: 'Agree goals and a plan together',
      detail:
        'Review the client’s priorities, preferences and the support that fits. A counselling plan can be agreed without a diagnosis.',
      why: 'Shared goals make the next step and the review point clear.',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // 5. Not-on-track review.
  const stalled = journey.instrumentChanges.find(
    (c) => c.administrationCount >= 3 && c.verdict === 'no_reliable_change',
  );
  if (actions.length < 3 && journey.activePlan && stalled && !deteriorating) {
    actions.push({
      title: 'Review the plan — not improving as expected',
      detail: `${stalled.instrumentKey} has shown no reliable improvement across ${stalled.administrationCount} administrations.`,
      why: 'Clients who are not on track benefit most from an early change of course.',
      when: 'next_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // Score improvement invites a whole-case review, never a discharge verdict.
  const improved = journey.instrumentChanges.some((c) => c.verdict === 'reliable_improvement');
  if (actions.length < 3 && journey.activePlan && improved && !deteriorating && !stalled) {
    actions.push({
      title: 'Review progress together',
      detail:
        'Review all relevant measures, agreed goals, everyday functioning, the client’s preference and safety. Improved scores alone do not establish readiness to end care.',
      why: 'Continuing, adapting or planning an ending is a shared whole-case decision.',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // First contact does not require audio recording or a diagnostic workflow.
  if (actions.length === 0 && journey.sessionsCompleted === 0) {
    actions.push({
      title: 'Start the first conversation',
      detail:
        'Explore the client’s concerns and priorities, discuss working together, and document what was actually discussed. Audio recording is optional.',
      why: 'A shared understanding comes before deciding which support fits.',
      when: 'this_session',
      ctaLabel: 'Open client',
      ctaHref: `/app/clients/${inputs.clientId}`,
    });
  }

  return actions.slice(0, 3);
}

// ============================================================================
// Cadence.
// ============================================================================

function buildCadence(journey: JourneySummary): CaseBriefingV1['cadence'] {
  // Heuristic: weekly while symptomatic / in assessment; widen as the
  // client improves; flag review at the 8-session mark.
  const latestSeverityKeys = journey.instrumentChanges.map((c) => c.latestSeverityKey);
  const stillSymptomatic = latestSeverityKeys.some(
    (k) => k === 'moderate' || k === 'moderately_severe' || k === 'severe',
  );
  const improving = journey.instrumentChanges.some((c) => c.verdict === 'reliable_improvement');
  const worsening = journey.instrumentChanges.some((c) => c.verdict === 'deterioration');

  let intervalDays = 7;
  let rationale =
    'Discuss timing with the client based on their goals, preference, functioning and safety; this is a planning suggestion.';
  if (worsening) {
    rationale =
      'Review worsening and safety with the client before agreeing the next contact; improvement on another measure does not justify longer gaps.';
  } else if (journey.stage === 'INTAKE' || journey.stage === 'ASSESSMENT') {
    intervalDays = 7;
    rationale =
      'Agree the next contact together while building a shared understanding; timing depends on clinical need and client preference.';
  } else if (improving && !stillSymptomatic) {
    intervalDays = 21;
    rationale = 'Symptoms have eased and are improving — spacing sessions out consolidates gains.';
  } else if (improving) {
    intervalDays = 14;
    rationale = 'Improving but still symptomatic — fortnightly maintains momentum.';
  } else if (stillSymptomatic) {
    intervalDays = 7;
    rationale = 'Symptoms remain moderate or higher — keep weekly contact.';
  }

  const reviewDueInSessions = journey.stage === 'REVIEW_DUE' ? 0 : journey.activePlan ? null : null;

  return { recommendedIntervalDays: intervalDays, rationale, reviewDueInSessions };
}

// ============================================================================
// Report readers.
// ============================================================================

function readReportFormulation(body: unknown): string | null {
  if (!body) return null;
  const treatment = ClinicalReportV1Schema.safeParse(body);
  if (treatment.success) return treatment.data.formulation;
  const intake = InitialAssessmentBriefV1Schema.safeParse(body);
  if (intake.success) return intake.data.formulation;
  return null;
}

function readTopDifferential(body: unknown): CaseBriefingV1['workingDiagnosis'] {
  if (!body) return null;
  const intake = InitialAssessmentBriefV1Schema.safeParse(body);
  if (intake.success && intake.data.differential.length > 0) {
    const top = intake.data.differential[0]!;
    return {
      icd11Code: top.icd11Code,
      icd11Label: top.icd11Label,
      confidence: top.confidence,
      confirmed: false,
    };
  }
  const treatment = ClinicalReportV1Schema.safeParse(body);
  if (treatment.success && treatment.data.primaryDiagnosisIndex !== null) {
    const top = treatment.data.diagnosisCandidates[treatment.data.primaryDiagnosisIndex];
    if (top) {
      return {
        icd11Code: top.icd11Code,
        icd11Label: top.icd11Label,
        confidence: top.confidence,
        confirmed: false,
      };
    }
  }
  return null;
}

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

function readCrisis(body: unknown): {
  highestSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  labels: string[];
} {
  const flags = (() => {
    const treatment = ClinicalReportV1Schema.safeParse(body);
    if (treatment.success) return treatment.data.crisisFlags;
    const intake = InitialAssessmentBriefV1Schema.safeParse(body);
    if (intake.success) return intake.data.crisisFlags;
    return [];
  })();
  if (flags.length === 0) return { highestSeverity: 'none', labels: [] };
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
  let highest: keyof typeof rank = 'none';
  for (const f of flags) if (rank[f.severity] > rank[highest]) highest = f.severity;
  return {
    highestSeverity: highest,
    labels: flags.map((f) => CRISIS_LABEL[f.kind] ?? f.kind),
  };
}

// ============================================================================
// Small string helpers.
// ============================================================================

function notElicited(s: string | undefined): s is string {
  if (!s) return false;
  const n = s.toLowerCase();
  return !n.includes('not elicited') && !n.includes('(none') && n.trim().length > 0;
}

function firstSentences(s: string | undefined, n: number): string {
  if (!s) return '';
  return s
    .split(/(?<=[.!?])\s+/)
    .slice(0, n)
    .join(' ');
}

function compact(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export type { CaseBriefingWhen };
