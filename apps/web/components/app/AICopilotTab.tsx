import { z } from 'zod';
import {
  CarriedQuestionSchema,
  CaseFormulationV1Schema,
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  IntakeNoteV1Schema,
  type ClinicalLocale,
  type SessionAgreementDto,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { CareBoard } from '@/components/app/CareBoard';
import {
  CloseLoopBoard,
  type CloseLoopCrisisFlag,
  type CloseLoopData,
} from '@/components/app/CloseLoopBoard';
import { CareMeasurePanel } from '@/components/app/CareMeasurePanel';
import { CareNextSessionPanel } from '@/components/app/CareNextSessionPanel';
import { CareStoryPanel } from '@/components/app/CareStoryPanel';
import { CaseConsultPanel } from '@/components/app/CaseConsultPanel';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import {
  CopilotDecisionBoard,
  type CaseRecordSnapshot,
} from '@/components/app/CopilotDecisionBoard';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { PlanHero, type PlanHeroData } from '@/components/app/PlanHero';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { AICopilotSubTabs, type CopilotSubKey } from '@/components/app/AICopilotSubTabs';
import { computeCareEngineForClient } from '@/lib/care-engine-compose';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';
import { JourneyError } from '@/lib/journey';
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
  sub: CopilotSubKey;
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

/**
 * Sprint 28 → Copilot IA redesign (R1) — the session AI Copilot.
 *
 * The session page is the therapist's primary workspace, so the whole
 * decision-support layer lives here behind one opt-in tab, grouped into
 * three sub-tabs that each answer a plain question:
 *
 * - **Review** (`sub=review`, default) — what the copilot heard this
 *   session; you decide. The decision board. (Mindmap + reflection
 *   questions moved out — to Transcript and Notes respectively.)
 * - **Progress** (`sub=progress`) — the treatment arc, is it working, and
 *   what next session opens with (the Care Engine page).
 * - **Plan** (`sub=plan`) — the client's own treatment plan (phases, goals
 *   with live status, versions), then the session scripts + formulation
 *   tools + the optional CBT/EMDR advancement tracker around it.
 *
 * Loading is sub-aware: each sub-tab fetches only what it renders, so a
 * therapist who only opens Review never pays for the progress/plan
 * queries. The client page is a lean record and carries none of this.
 */
export async function AICopilotTab({
  sessionId,
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  preferredLanguage,
  sessionKind,
  sub,
}: Props) {
  return (
    <div className="space-y-6">
      <AICopilotSubTabs sessionId={sessionId} active={sub} />
      {sub === 'close' && (
        <CloseSub
          sessionId={sessionId}
          clientId={clientId}
          psychologistId={psychologistId}
          clientName={clientName}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
          preferredLanguage={preferredLanguage}
          sessionKind={sessionKind}
        />
      )}
      {sub === 'review' && (
        <SessionSub sessionId={sessionId} clientId={clientId} sessionKind={sessionKind} />
      )}
      {sub === 'progress' && (
        <JourneySub
          sessionId={sessionId}
          clientId={clientId}
          psychologistId={psychologistId}
          clientName={clientName}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
        />
      )}
      {sub === 'plan' && (
        <PlanSub
          sessionId={sessionId}
          clientId={clientId}
          preferredLanguage={preferredLanguage}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
        />
      )}
    </div>
  );
}

// ----- sub-tab bodies -----

/**
 * The Session Loop (SL1) — "Close the loop": the five-moment end-of-session
 * surface (what happened / what it means / what we agreed / is it working /
 * anything to watch), closed by the ONE note signature. Default sub when a
 * completed session hasn't been signed yet.
 */
async function CloseSub({
  sessionId,
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  preferredLanguage,
  sessionKind,
}: {
  sessionId: string;
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  preferredLanguage: string;
  sessionKind: SessionKind;
}) {
  const isIntake = sessionKind === 'INTAKE';
  const [
    sessionRow,
    draft,
    signedRow,
    reportRow,
    formulationRow,
    agreementRows,
    instruments,
    openItems,
    signer,
  ] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, allianceRating: true },
    }),
    prisma.noteDraft.findUnique({ where: { sessionId }, select: { status: true, content: true } }),
    prisma.therapyNote.findUnique({
      where: { sessionId },
      select: { signedAt: true, content: true },
    }),
    prisma.clinicalReport.findUnique({ where: { sessionId } }),
    prisma.caseFormulation.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.sessionAgreement.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: { administeredAt: 'desc' },
      take: 8,
      select: { instrumentKey: true, score: true, severity: true, administeredAt: true },
    }),
    prisma.assessmentItem.findMany({
      where: { clientId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { question: true },
    }),
    prisma.psychologist.findUnique({ where: { id: psychologistId }, select: { fullName: true } }),
  ]);

  // The note to display + sign: the signed content when it exists, else the
  // completed draft. Summary line narrows by session kind (Sprint 19 union).
  const noteContent = signedRow?.content ?? (draft?.status === 'COMPLETED' ? draft.content : null);
  let noteSummary: string | null = null;
  if (noteContent) {
    if (isIntake) {
      const parsed = IntakeNoteV1Schema.safeParse(noteContent);
      noteSummary = parsed.success ? excerpt(parsed.data.presentingConcerns) : null;
    } else {
      const note = noteContent as unknown as TherapyNoteV1;
      noteSummary = excerpt(note.summary ?? note.subjective ?? '');
    }
  }

  // Formulation suggestions + crisis flags come from the session's Pass 3
  // output — the report shape for treatment sessions, the intake brief for
  // intakes (which carries crisis flags but no formulation suggestions).
  let suggestions: CloseLoopData['suggestions'] = [];
  let crisisFlags: CloseLoopCrisisFlag[] = [];
  let reportId: string | null = null;
  if (reportRow && reportRow.status === 'COMPLETED' && reportRow.body) {
    if (isIntake) {
      const brief = readInitialAssessmentBrief(reportRow);
      crisisFlags = (brief?.crisisFlags ?? []).map((f) => ({
        kind: f.kind,
        severity: f.severity,
        recommendedAction: f.recommendedAction,
      }));
    } else {
      const parsed = ClinicalReportV1Schema.safeParse(reportRow.body);
      if (parsed.success) {
        reportId = reportRow.id;
        suggestions = parsed.data.formulationSuggestions;
        crisisFlags = parsed.data.crisisFlags.map((f) => ({
          kind: f.kind,
          severity: f.severity,
          recommendedAction: f.recommendedAction,
        }));
      }
    }
  }

  const formulationParse = formulationRow
    ? CaseFormulationV1Schema.safeParse(formulationRow.body)
    : null;

  const agreements: SessionAgreementDto[] = agreementRows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    text: r.text,
    speaker: r.speaker,
    followUp: r.followUp,
    createdAt: r.createdAt.toISOString(),
  }));

  const data: CloseLoopData = {
    sessionId,
    clientId,
    clientName,
    sessionKind,
    sessionCompleted: sessionRow?.status === 'COMPLETED',
    hasContactPhone: clientHasContactPhone,
    hasContactEmail: clientHasContactEmail,
    preferredLanguage,
    noteReady: noteContent !== null,
    noteContent,
    noteSummary,
    signed: signedRow
      ? { signedAt: signedRow.signedAt.toISOString(), signerName: signer?.fullName ?? '' }
      : null,
    reportId,
    suggestions,
    formulation:
      formulationRow && formulationParse?.success
        ? {
            version: formulationRow.version,
            confirmedAt: formulationRow.confirmedAt.toISOString(),
            body: formulationParse.data,
          }
        : null,
    agreements,
    measures: instruments.map((i) => ({
      instrumentKey: i.instrumentKey,
      score: i.score,
      severity: i.severity,
      administeredAt: i.administeredAt.toISOString(),
    })),
    alliance: sessionRow?.allianceRating ?? null,
    crisisFlags,
    openQuestions: openItems.map((i) => i.question),
  };

  return <CloseLoopBoard data={data} />;
}

/** First ~360 chars of a note section, cut at a word boundary. */
function excerpt(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  if (t.length <= 360) return t;
  const cut = t.slice(0, 360);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 300))}…`;
}

async function SessionSub({
  sessionId,
  clientId,
  sessionKind,
}: {
  sessionId: string;
  clientId: string;
  sessionKind: SessionKind;
}) {
  const isIntake = sessionKind === 'INTAKE';
  // The board's right lane is the client's confirmed record — loaded here
  // (server truth) and refreshed via router.refresh() after each accept.
  const [reportRow, draft, signed, client, diagnoses, activePlan, instruments, safetyPlan] =
    await Promise.all([
      prisma.clinicalReport.findUnique({ where: { sessionId } }),
      prisma.noteDraft.findUnique({ where: { sessionId }, select: { content: true } }),
      prisma.therapyNote.findUnique({ where: { sessionId }, select: { content: true } }),
      prisma.client.findUnique({ where: { id: clientId }, select: { carriedQuestions: true } }),
      prisma.clientDiagnosis.findMany({
        where: { clientId, supersededAt: null },
        orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
        select: {
          icd11Code: true,
          icd11Label: true,
          isPrimary: true,
          confirmedAt: true,
          sessionId: true,
        },
      }),
      prisma.treatmentPlan.findFirst({
        where: { clientId, supersededAt: null },
        orderBy: { version: 'desc' },
        select: { version: true, body: true, confirmedAt: true },
      }),
      prisma.instrumentResponse.findMany({
        where: { clientId },
        orderBy: { administeredAt: 'desc' },
        take: 6,
        select: { instrumentKey: true, score: true, severity: true, administeredAt: true },
      }),
      prisma.safetyPlan.findFirst({
        where: { clientId, supersededAt: null },
        select: { confirmedAt: true },
      }),
    ]);
  const noteJson = (signed?.content ?? draft?.content) as TherapyNoteV1 | null;

  const planBody = activePlan ? ClinicalTreatmentPlanSchema.safeParse(activePlan.body) : null;
  const carriedParse = z.array(CarriedQuestionSchema).safeParse(client?.carriedQuestions);
  const record: CaseRecordSnapshot = {
    diagnoses: diagnoses.map((d) => ({
      icd11Code: d.icd11Code,
      icd11Label: d.icd11Label,
      isPrimary: d.isPrimary,
      confirmedAt: d.confirmedAt.toISOString(),
      sessionId: d.sessionId,
    })),
    plan: activePlan
      ? {
          version: activePlan.version,
          modality: planBody?.success ? planBody.data.modality : 'other',
          goalCount: planBody?.success ? planBody.data.goals.length : 0,
          confirmedAt: activePlan.confirmedAt.toISOString(),
        }
      : null,
    instruments: instruments.map((i) => ({
      instrumentKey: i.instrumentKey,
      score: i.score,
      severity: i.severity,
      administeredAt: i.administeredAt.toISOString(),
    })),
    safetyPlanConfirmedAt: safetyPlan?.confirmedAt.toISOString() ?? null,
    carriedQuestions: carriedParse.success ? carriedParse.data : [],
  };

  return (
    <div className="space-y-8">
      <CopilotDecisionBoard
        sessionId={sessionId}
        clientId={clientId}
        sessionKind={sessionKind}
        initialReport={reportRow ? toClinicalReport(reportRow) : null}
        initialBrief={isIntake && reportRow ? readInitialAssessmentBrief(reportRow) : null}
        reviewedAt={reportRow?.reviewedAt?.toISOString() ?? null}
        record={record}
      />
      {/* Mindmap + reflection questions moved out of the decision flow (R1):
          the mindmap is a view of the note (→ Transcript), reflection
          questions are client-facing (→ Notes). Left here as quiet links so
          the Review board stays a pure decision surface. */}
      {!isIntake && noteJson && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-[var(--color-ink-3)]">
          <span className="font-semibold uppercase tracking-[0.12em]">Also from this session</span>
          <a
            href={`/app/sessions/${sessionId}?tab=transcript`}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            Session mindmap →
          </a>
          <span aria-hidden>·</span>
          <a
            href={`/app/sessions/${sessionId}?tab=notes`}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            Reflection questions →
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Sprint JE3 → JE6 — the Care Engine page: FOUR cards, one home per fact.
 *
 * Driven by ONE deterministic state machine (`computeCareEngineForClient` →
 * CareEngineV1). JE6 collapsed the previous five zones / eleven cards after
 * a UX audit found the page still said things twice (gate vs queue, scores
 * in three places, diagnosis + cadence + crisis repeated):
 *
 *   1. Care journey (CareBoard) — stage strip + the exit gate rendered AS
 *      the do-next checklist (met = ✓ with evidence, open = the action
 *      itself, inline). Diagnosis lives here and nowhere else.
 *   2. Is it working? (CareMeasurePanel) — per-instrument verdict rows with
 *      the administration form inline (scoring refreshes the board),
 *      history folded, plan goals, affect. Scores live here and nowhere else.
 *   3. The story so far (CareStoryPanel) — headline + 5 Ps + the chat and
 *      the case consult folded inside.
 *   4. Next session (CareNextSessionPanel) — cadence + the ranked carried
 *      questions + the AI brief's unique fields (its crisis banner and
 *      score list are deliberately not rendered — they have homes above).
 */
async function JourneySub({
  sessionId,
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  sessionId: string;
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}) {
  const [care, briefing, clientRow] = await Promise.all([
    computeCareEngineForClient(clientId, psychologistId, sessionId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
    buildDeterministicCaseBriefing(clientId, psychologistId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
    // The therapist's carried picks (Client.carriedQuestions) — mirrored on the
    // "Next session" card so the open assessment ledger and the carry-picks that
    // seed the AI brief read as two distinct lists (R3b).
    prisma.client.findFirst({
      where: { id: clientId, psychologistId },
      select: { carriedQuestions: true },
    }),
  ]);

  const carried = z.array(CarriedQuestionSchema).safeParse(clientRow?.carriedQuestions);
  const reviewHref = `/app/sessions/${sessionId}?tab=copilot&sub=review`;

  if (!care) {
    return (
      <EmptyState
        title="No care journey yet"
        body="The care engine composes from the cumulative client record. Record the first session to begin the arc."
      />
    );
  }

  // A shareable report needs ≥1 instrument with a reliable-change verdict.
  const canShareReport = care.measures.some((m) => m.verdict !== null);
  const isDischarged = care.arc.discharged !== null;

  return (
    <div className="space-y-6">
      <CareBoard
        arc={care.arc}
        queue={care.queue}
        workingDiagnosis={care.workingDiagnosis}
        canShareReport={canShareReport}
        clientId={clientId}
        clientName={clientName}
        clientHasContactPhone={clientHasContactPhone}
        clientHasContactEmail={clientHasContactEmail}
        planHref={`/app/sessions/${sessionId}?tab=copilot&sub=plan`}
      />

      <CareMeasurePanel
        measures={care.measures}
        activePlan={care.activePlan}
        clientId={clientId}
        disabled={isDischarged}
        hasContactPhone={clientHasContactPhone}
        hasContactEmail={clientHasContactEmail}
      />

      {briefing ? (
        <CareStoryPanel clientId={clientId} clientName={clientName} initialBriefing={briefing} />
      ) : (
        // No briefing yet — keep the consult reachable (it's folded into the
        // story card whenever the briefing exists).
        <Card id="care-consult" className="scroll-mt-24 p-6">
          <h2 className="mb-3 font-serif text-2xl">Case consult</h2>
          <CaseConsultPanel clientId={clientId} />
        </Card>
      )}

      <CareNextSessionPanel
        questions={care.questions}
        cadence={care.cadence}
        clientId={clientId}
        carried={carried.success ? carried.data : []}
        reviewHref={reviewHref}
      />
    </div>
  );
}

/**
 * Copilot IA redesign (R2) — the Plan sub-tab.
 *
 * The tab named "Plan & toolkit" used to render a map, diagnosis history, a
 * therapy library and a "Workflow" form — but not the client's actual
 * treatment plan, which had no full in-app view. This now leads with the
 * plan itself (PlanHero: phases, goals + live status, versions), then the
 * supporting tools: session scripts, formulation map, diagnosis history, and
 * the CBT/EMDR advancement tracker (demoted to a collapsed "advanced" section
 * — it's a separate phase engine, not a second plan).
 */
async function PlanSub({
  sessionId,
  clientId,
  preferredLanguage,
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  sessionId: string;
  clientId: string;
  preferredLanguage: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}) {
  const [latestReport, activePlan, versionCount, diagnoses] = await Promise.all([
    prisma.clinicalReport.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, body: true, confirmedAt: true },
    }),
    prisma.treatmentPlan.count({ where: { clientId } }),
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
  ]);

  // Resolve the plan body + per-goal live status from the side table.
  let planHero: PlanHeroData | null = null;
  if (activePlan) {
    const planBody = ClinicalTreatmentPlanSchema.safeParse(activePlan.body);
    if (planBody.success) {
      const progress = await prisma.treatmentGoalProgress.findMany({
        where: { treatmentPlanId: activePlan.id },
        select: { goalIndex: true, status: true },
      });
      const statusByIndex = new Map(progress.map((p) => [p.goalIndex, p.status]));
      planHero = {
        id: activePlan.id,
        version: activePlan.version,
        modality: planBody.data.modality,
        expectedDurationSessions: planBody.data.expectedDurationSessions,
        phaseSequence: planBody.data.phaseSequence,
        goals: planBody.data.goals.map((g, i) => ({
          description: g.description,
          measure: g.measure,
          status: statusByIndex.get(i) ?? 'NOT_STARTED',
        })),
        confirmedAt: activePlan.confirmedAt.toISOString(),
      };
    }
  }

  const primaryActive =
    diagnoses.find((d) => d.supersededAt === null && d.isPrimary) ??
    diagnoses.find((d) => d.supersededAt === null) ??
    null;

  const recommendedTherapies = extractRecommended(latestReport?.body);
  const langParse = ClinicalLocaleSchema.safeParse(preferredLanguage);
  const defaultLanguage: ClinicalLocale = langParse.success ? langParse.data : 'en';
  const reviewHref = `/app/sessions/${sessionId}?tab=copilot&sub=review`;

  return (
    <div className="space-y-6">
      <PlanHero
        plan={planHero}
        versionCount={versionCount}
        primaryDiagnosis={
          primaryActive
            ? { icd11Code: primaryActive.icd11Code, icd11Label: primaryActive.icd11Label }
            : null
        }
        reviewHref={reviewHref}
      />

      <TherapyLibrary
        clientId={clientId}
        recommendedTherapies={recommendedTherapies}
        libraryTherapies={LIBRARY_THERAPIES}
        defaultLanguage={defaultLanguage}
        activeTreatmentPlanId={activePlan?.id ?? null}
        clientHasContactPhone={clientHasContactPhone}
        clientHasContactEmail={clientHasContactEmail}
      />

      {diagnoses.length > 0 && <DiagnosisHistoryCard diagnoses={diagnoses} />}
      <ConceptualMapTab clientId={clientId} />

      {/* The CBT/EMDR advancement engine is a separate phase tracker, not a
          second plan — demoted to an optional collapsed section (R2). */}
      <details className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink-2)]">
          Phase advancement tracker (CBT / EMDR) — optional
        </summary>
        <p className="mb-3 mt-1 text-xs text-[var(--color-ink-3)]">
          A manualised phase-progression aid with exercise prescriptions. Separate from the plan
          above — start it only if you want per-phase advancement suggestions.
        </p>
        <WorkflowSection clientId={clientId} />
      </details>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-10 text-center">
      <p className="font-serif text-xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">{body}</p>
    </Card>
  );
}

function extractRecommended(body: unknown): string[] {
  if (body === null || body === undefined) return [];
  const parsed = ClinicalReportV1Schema.safeParse(body);
  if (!parsed.success) return [];
  return parsed.data.recommendedTherapies.map((t) => t.name);
}
