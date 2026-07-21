import {
  CaseFormulationV1Schema,
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  type ClinicalLocale,
  type FormulationSuggestion,
  type SessionKind,
} from '@cureocity/contracts';
import {
  PlanOfCareSheet,
  type PlanOfCareData,
  type PocOutcome,
} from '@/components/app/PlanOfCareSheet';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { FormulationCard, type FormulationCardData } from '@/components/app/FormulationCard';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { fetchOpenCrises } from '@/lib/crisis-flags';
import { formatIstDate } from '@/lib/ist';
import { computeClientJourney, JourneyError } from '@/lib/journey';
import { isSuggestionApplied } from '@/lib/formulation-applied';
import { prisma } from '@/lib/prisma';

interface Props {
  sessionId: string;
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  preferredLanguage: string;
  sessionKind: SessionKind;
}

const LIBRARY_THERAPIES: string[] = [
  'Cognitive Restructuring',
  'Behavioural Activation',
  'Graded Exposure',
  'Mindfulness-Based Cognitive Therapy',
  'Acceptance and Commitment Therapy',
  'Problem-Solving Therapy',
  'Sleep Hygiene + Stimulus Control',
  'EMDR Phase 3 — Assessment',
  'EMDR Phase 4 — Desensitisation',
  'Motivational Interviewing',
];

/** Remission cutoffs mirrored from packages/clinical change-score. */
const REMISSION_CUTOFF: Record<string, number> = { PHQ9: 4, GAD7: 4 };

const INSTRUMENT_LABEL: Record<string, string> = { PHQ9: 'PHQ-9', GAD7: 'GAD-7' };

/**
 * PC1 — the Plan of care tab: the psychologist's clinical document (the
 * sheet), composed entirely from the existing record — problems,
 * formulation, diagnoses, plan + goal progress, instrument verdicts,
 * safety, agreements, open review items. Below it, the quiet Tools drawer
 * (scripts, formulation editor, diagnosis history, conceptual map, phase
 * tracker) that used to be the copilot's Plan sub.
 */
export async function PlanOfCareTab({
  sessionId,
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  preferredLanguage,
}: Props) {
  const [
    therapist,
    client,
    problems,
    formulationRow,
    diagnoses,
    allDiagnoses,
    activePlan,
    planVersionCount,
    latestReport,
    instrumentRows,
    completedSessions,
    safetyPlan,
    openCrises,
    openItems,
    lastSigned,
    recentReports,
  ] = await Promise.all([
    prisma.psychologist.findUnique({ where: { id: psychologistId }, select: { fullName: true } }),
    prisma.client.findUnique({
      where: { id: clientId },
      select: { createdAt: true, presentingConcerns: true },
    }),
    prisma.problemListItem.findMany({
      where: { clientId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 6,
      select: { title: true, detail: true, status: true },
    }),
    prisma.caseFormulation.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.clientDiagnosis.findMany({
      where: { clientId, supersededAt: null },
      orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
      select: { icd11Code: true, icd11Label: true, isPrimary: true, confirmedAt: true },
    }),
    prisma.clientDiagnosis.findMany({
      where: { clientId },
      orderBy: [{ supersededAt: 'asc' }, { confirmedAt: 'desc' }],
      select: {
        id: true,
        icd11Code: true,
        icd11Label: true,
        confidence: true,
        isPrimary: true,
        confirmedAt: true,
        supersededAt: true,
      },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, body: true, confirmedAt: true },
    }),
    prisma.treatmentPlan.count({ where: { clientId } }),
    prisma.clinicalReport.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true },
    }),
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: { administeredAt: 'asc' },
      select: { instrumentKey: true, score: true },
    }),
    prisma.session.findMany({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { scheduledAt: 'asc' },
      select: { allianceRating: true, scheduledAt: true },
    }),
    prisma.safetyPlan.findFirst({
      where: { clientId, supersededAt: null },
      select: { confirmedAt: true },
    }),
    fetchOpenCrises(clientId),
    prisma.assessmentItem.findMany({
      where: { clientId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 3,
      select: { question: true },
    }),
    prisma.therapyNote.findFirst({
      where: { session: { clientId } },
      orderBy: { signedAt: 'desc' },
      select: { signedAt: true },
    }),
    prisma.clinicalReport.findMany({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, body: true },
    }),
  ]);

  const journey = await computeClientJourney(clientId, psychologistId).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });

  const formulationParse = formulationRow
    ? CaseFormulationV1Schema.safeParse(formulationRow.body)
    : null;
  const formulation = formulationRow && formulationParse?.success ? formulationParse.data : null;

  const planParse = activePlan ? ClinicalTreatmentPlanSchema.safeParse(activePlan.body) : null;
  const planBody = activePlan && planParse?.success ? planParse.data : null;
  const goalProgress = activePlan
    ? await prisma.treatmentGoalProgress.findMany({
        where: { treatmentPlanId: activePlan.id },
        select: { goalIndex: true, status: true },
      })
    : [];
  const statusByIndex = new Map(goalProgress.map((p) => [p.goalIndex, p.status]));

  // Outcome rows — series per instrument + the journey's deterministic
  // reliable-change verdicts.
  const seriesByKey = new Map<string, number[]>();
  for (const r of instrumentRows) {
    const list = seriesByKey.get(r.instrumentKey) ?? [];
    list.push(r.score);
    seriesByKey.set(r.instrumentKey, list);
  }
  const outcomes: PocOutcome[] = [];
  for (const [key, series] of seriesByKey.entries()) {
    if (series.length === 0) continue;
    const change = journey?.instrumentChanges.find((c) => c.instrumentKey === key) ?? null;
    const latest = series[series.length - 1]!;
    const cutoff = REMISSION_CUTOFF[key];
    const remitted = change?.isRemission ?? (cutoff !== undefined && latest <= cutoff);
    const improving = change?.verdict === 'reliable_improvement';
    const worsening = change?.verdict === 'deterioration';
    outcomes.push({
      label: INSTRUMENT_LABEL[key] ?? key,
      baseline: String(series[0]!),
      course: series.join(' · '),
      now: String(latest),
      target: cutoff !== undefined ? `≤ ${cutoff} ×2` : '—',
      verdict: remitted
        ? 'remission — confirm at review'
        : improving
          ? 'reliable improvement'
          : worsening
            ? 'deterioration — review the plan'
            : 'no reliable change yet',
      good: remitted || improving,
    });
  }

  const allianceValues = completedSessions
    .map((s) => s.allianceRating)
    .filter((a): a is NonNullable<typeof a> => a !== null);
  const allianceCourse =
    allianceValues.length > 0 ? allianceValues.map((a) => a.toLowerCase()).join(' · ') : null;

  // Risk line — status, not drama.
  let riskLevel: PlanOfCareData['riskLevel'] = 'none';
  let riskLine = 'No safety concerns on record.';
  if (openCrises.length > 0) {
    riskLevel = 'elevated';
    riskLine = `Open flag${openCrises.length > 1 ? 's' : ''}: ${openCrises
      .map((c) => c.kind.replace(/_/g, ' '))
      .join(', ')} — start the next session with a safety check.${
      safetyPlan ? ` Safety plan on file, ${formatIstDate(safetyPlan.confirmedAt)}.` : ''
    }`;
  } else if (safetyPlan) {
    riskLevel = 'low';
    riskLine = `No open flags. Safety plan on file, confirmed ${formatIstDate(safetyPlan.confirmedAt)} — warning signs, coping steps, contacts.`;
  }

  // Agreements from the most recent completed session that has any.
  const lastAgreementSession = await prisma.sessionAgreement.findFirst({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    select: { sessionId: true },
  });
  const agreements = lastAgreementSession
    ? await prisma.sessionAgreement.findMany({
        where: { sessionId: lastAgreementSession.sessionId },
        orderBy: { createdAt: 'asc' },
        select: { text: true, speaker: true },
      })
    : [];

  const instrumentNames = outcomes.map((o) => o.label);
  const dischargeLine =
    instrumentNames.length > 0
      ? `${instrumentNames.join(' + ')} in remission at two administrations ≥ 2 weeks apart · plan goals achieved · agreed together.`
      : 'Plan goals achieved · sustained improvement · agreed together.';

  // º provenance — applied copilot suggestions with the client's words.
  // A suggestion counts as applied when its content is now in the active
  // formulation (same check both surfaces use) or matches a plan goal.
  const provenance: { text: string; quote: string | null }[] = [];
  for (const r of recentReports) {
    if (!r.body) continue;
    const parsed = ClinicalReportV1Schema.safeParse(r.body);
    if (!parsed.success) continue;
    for (const s of parsed.data.formulationSuggestions as FormulationSuggestion[]) {
      if (formulation && isSuggestionApplied(formulation, s)) {
        provenance.push({ text: s.text, quote: s.evidenceQuote });
      }
    }
    for (const ps of parsed.data.planSuggestions) {
      if (
        ps.goal &&
        planBody?.goals.some(
          (g) => g.description.trim().toLowerCase() === ps.goal!.description.trim().toLowerCase(),
        )
      ) {
        provenance.push({ text: ps.goal.description, quote: null });
      }
    }
  }

  const data: PlanOfCareData = {
    clientId,
    clientName,
    // "Care began" = the first completed session, not the row-creation date
    // (backdated/imported clients would otherwise show the import day).
    clientSince:
      completedSessions[0]?.scheduledAt.toISOString() ?? client?.createdAt.toISOString() ?? null,
    hasContactPhone: clientHasContactPhone,
    hasContactEmail: clientHasContactEmail,
    preferredLanguage,
    therapistName: therapist?.fullName ?? 'Clinician',
    sessionCount: completedSessions.length,
    modality: planBody?.modality ?? null,
    expectedDurationSessions: planBody?.expectedDurationSessions ?? null,
    planId: activePlan?.id ?? null,
    planVersion: activePlan?.version ?? null,
    planConfirmedAt: activePlan?.confirmedAt.toISOString() ?? null,
    planVersionCount,
    problems: problems.map((p) => ({ title: p.title, detail: p.detail, status: p.status })),
    presentingFallback: client?.presentingConcerns ?? null,
    formulation: formulation
      ? {
          version: formulationRow!.version,
          confirmedAt: formulationRow!.confirmedAt.toISOString(),
          narrative: formulation.narrative,
          cycle: formulation.cycle,
          protective: formulation.fivePs.protective,
        }
      : null,
    diagnoses: diagnoses.map((d) => ({
      icd11Code: d.icd11Code,
      icd11Label: d.icd11Label,
      isPrimary: d.isPrimary,
      confirmedAt: d.confirmedAt.toISOString(),
    })),
    goals: (planBody?.goals ?? []).map((g, i) => ({
      index: i,
      description: g.description,
      measure: g.measure,
      interventions: g.interventions,
      status: statusByIndex.get(i) ?? 'NOT_STARTED',
    })),
    outcomes,
    allianceCourse,
    riskLine,
    riskLevel,
    agreements: agreements.map((a) => ({ text: a.text, speaker: a.speaker })),
    reviewItems: openItems.map((i) => i.question),
    dischargeLine,
    lastSignedLine: lastSigned ? `Last session signed ${formatIstDate(lastSigned.signedAt)}` : null,
    provenance,
  };

  // Tools drawer — the copilot's former Plan sub, one quiet layer down.
  const latestReportParse = latestReport?.body
    ? ClinicalReportV1Schema.safeParse(latestReport.body)
    : null;
  const formulationCard: FormulationCardData = {
    clientId,
    formulation:
      formulationRow && formulation
        ? {
            version: formulationRow.version,
            confirmedAt: formulationRow.confirmedAt.toISOString(),
            body: formulation,
          }
        : null,
    reportId: latestReportParse?.success ? (latestReport?.id ?? null) : null,
    suggestions: latestReportParse?.success ? latestReportParse.data.formulationSuggestions : [],
  };
  const recommendedTherapies = latestReportParse?.success
    ? latestReportParse.data.recommendedTherapies.map((t) => t.name)
    : [];
  const langParse = ClinicalLocaleSchema.safeParse(preferredLanguage);
  const defaultLanguage: ClinicalLocale = langParse.success ? langParse.data : 'en';
  void sessionId;

  return (
    <div className="space-y-6">
      <PlanOfCareSheet data={data} />

      <details className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4 print:hidden">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink-2)]">
          Tools — scripts, formulation editor, diagnosis history, conceptual map
        </summary>
        <div className="mt-4 space-y-6">
          <FormulationCard data={formulationCard} />
          <TherapyLibrary
            clientId={clientId}
            recommendedTherapies={recommendedTherapies}
            libraryTherapies={LIBRARY_THERAPIES}
            defaultLanguage={defaultLanguage}
            activeTreatmentPlanId={activePlan?.id ?? null}
            clientHasContactPhone={clientHasContactPhone}
            clientHasContactEmail={clientHasContactEmail}
          />
          {allDiagnoses.length > 0 && <DiagnosisHistoryCard diagnoses={allDiagnoses} />}
          <ConceptualMapTab clientId={clientId} />
          <details className="rounded-2xl border border-[var(--color-line-soft)] bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink-2)]">
              Phase advancement tracker (CBT / EMDR) — optional
            </summary>
            <WorkflowSection clientId={clientId} />
          </details>
        </div>
      </details>
    </div>
  );
}
