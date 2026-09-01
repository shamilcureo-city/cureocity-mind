import { z } from 'zod';
import {
  CarriedQuestionSchema,
  CaseFormulationV1Schema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  type FormulationSuggestion,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { CareBoard } from '@/components/app/CareBoard';
import { CareMeasurePanel } from '@/components/app/CareMeasurePanel';
import { CareNextSessionPanel } from '@/components/app/CareNextSessionPanel';
import { CareStoryPanel } from '@/components/app/CareStoryPanel';
import { CaseConsultPanel } from '@/components/app/CaseConsultPanel';
import {
  CopilotDecisionBoard,
  type CaseRecordSnapshot,
  type CloseoutData,
} from '@/components/app/CopilotDecisionBoard';
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
  showSubTabs?: boolean;
}

/**
 * Sprint 28 → Copilot IA redesign (R1) — the session AI Copilot.
 *
 * The session page is the therapist's primary workspace, so the whole
 * decision-support layer lives here behind one opt-in tab, in two sub-tabs:
 *
 * - **Session** (`sub=session`, default) — ONE board worked top-to-bottom:
 *   safety → impression → ask-next → plan → wrap up & sign. The CP merge
 *   folded the old "Close the loop" sub in; the note signature is the one
 *   ceremony that ends a session. (Mindmap moved out — to Transcript.)
 * - **Progress** (`sub=progress`) — the treatment arc, is it working, and
 *   what next session opens with (the Care Engine page).
 *
 * PC1 moved the plan out entirely: the client's plan, formulation and the
 * supporting tools live on the top-level **Plan of care** tab
 * (`PlanOfCareTab`) — the copilot proposes, the paper holds what the
 * psychologist accepted.
 *
 * Loading is sub-aware: each sub-tab fetches only what it renders. The
 * client page is a lean record and carries none of this.
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
  showSubTabs = true,
}: Props) {
  return (
    <div className="space-y-6">
      {showSubTabs && <AICopilotSubTabs sessionId={sessionId} active={sub} />}
      {sub === 'session' && (
        <SessionSub
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
      {sub === 'progress' && (
        <ClientJourneyContent
          sessionId={sessionId}
          clientId={clientId}
          psychologistId={psychologistId}
          clientName={clientName}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
        />
      )}
    </div>
  );
}

// ----- sub-tab bodies -----

/**
 * The Session board — the CP merge of the old "Close the loop" + "Review"
 * subs. One query pass gathers BOTH what the board decides on (the report /
 * brief + the client's confirmed record) and what the wrap card closes with
 * (note readiness, signature state, agreements, alliance, formulation
 * suggestions). The right lane is server truth, refreshed via
 * router.refresh() after each accept.
 */
async function SessionSub({
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
    reportRow,
    draft,
    signedRow,
    client,
    diagnoses,
    activePlan,
    instruments,
    safetyPlan,
    sessionRow,
    formulationRow,
    agreementRows,
    signer,
  ] = await Promise.all([
    prisma.clinicalReport.findUnique({ where: { sessionId } }),
    prisma.noteDraft.findUnique({ where: { sessionId }, select: { status: true, content: true } }),
    prisma.therapyNote.findUnique({
      where: { sessionId },
      select: { signedAt: true, content: true, locked: true },
    }),
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
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { allianceRating: true },
    }),
    prisma.caseFormulation.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.sessionAgreement.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
    prisma.psychologist.findUnique({ where: { id: psychologistId }, select: { fullName: true } }),
  ]);
  const noteJson = (signedRow?.content ?? draft?.content) as TherapyNoteV1 | null;

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

  // Formulation suggestions ride the treatment report only (the intake brief
  // has no formulation-as-diff section).
  let formulationSuggestions: FormulationSuggestion[] = [];
  if (!isIntake && reportRow?.status === 'COMPLETED' && reportRow.body) {
    const parsed = ClinicalReportV1Schema.safeParse(reportRow.body);
    if (parsed.success) formulationSuggestions = parsed.data.formulationSuggestions;
  }
  const formulationParse = formulationRow
    ? CaseFormulationV1Schema.safeParse(formulationRow.body)
    : null;

  // The note to sign: the signed content when it exists, else the completed draft.
  const noteContent = signedRow?.content ?? (draft?.status === 'COMPLETED' ? draft.content : null);

  const closeout: CloseoutData = {
    clientName,
    hasContactPhone: clientHasContactPhone,
    hasContactEmail: clientHasContactEmail,
    preferredLanguage,
    noteReady: noteContent !== null,
    noteContent,
    signed: signedRow
      ? { signedAt: signedRow.signedAt.toISOString(), signerName: signer?.fullName ?? '' }
      : null,
    // A signed note that was re-opened for editing (locked=false) is NOT a
    // closed session — the wrap card must say "awaiting re-sign", not offer
    // Share of the superseded signed content.
    noteUnlocked: signedRow ? !signedRow.locked : false,
    agreements: agreementRows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      text: r.text,
      speaker: r.speaker,
      followUp: r.followUp,
      createdAt: r.createdAt.toISOString(),
    })),
    alliance: sessionRow?.allianceRating ?? null,
    formulationSuggestions,
    formulationBody: formulationParse?.success ? formulationParse.data : null,
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
        closeout={closeout}
      />
      {/* The mindmap moved out of the decision flow (R1): it's a view of the
          note (→ Transcript). Left here as a quiet link so the Session board
          stays a pure decision surface. */}
      {!isIntake && noteJson && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-[var(--color-ink-3)]">
          <span className="font-semibold uppercase tracking-[0.12em]">Also from this session</span>
          <a
            href={`/app/sessions/${sessionId}?tab=transcript`}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            Session mindmap →
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
export async function ClientJourneyContent({
  sessionId,
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  sessionId: string | null;
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
  const reviewHref = sessionId ? `/app/sessions/${sessionId}` : null;

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
        planHref={`/app/clients/${clientId}/plan`}
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-10 text-center">
      <p className="font-serif text-xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">{body}</p>
    </Card>
  );
}
