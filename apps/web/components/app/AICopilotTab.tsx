import { z } from 'zod';
import {
  CarriedQuestionSchema,
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  type ClinicalLocale,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { CareBoard } from '@/components/app/CareBoard';
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
 * - **Plan & toolkit** (`sub=plan`) — the client's plan + formulation
 *   tools. (R2 renames this to "Plan" once it renders the real plan.)
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
        <FormulationSub
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
  const [care, briefing] = await Promise.all([
    computeCareEngineForClient(clientId, psychologistId, sessionId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
    buildDeterministicCaseBriefing(clientId, psychologistId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
  ]);

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

      <CareNextSessionPanel questions={care.questions} cadence={care.cadence} clientId={clientId} />
    </div>
  );
}

async function FormulationSub({
  clientId,
  preferredLanguage,
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  clientId: string;
  preferredLanguage: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}) {
  const [latestReport, activePlan, diagnoses] = await Promise.all([
    prisma.clinicalReport.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true },
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
  ]);

  const recommendedTherapies = extractRecommended(latestReport?.body);
  const langParse = ClinicalLocaleSchema.safeParse(preferredLanguage);
  const defaultLanguage: ClinicalLocale = langParse.success ? langParse.data : 'en';

  return (
    <div className="space-y-6">
      <ConceptualMapTab clientId={clientId} />
      {diagnoses.length > 0 && <DiagnosisHistoryCard diagnoses={diagnoses} />}
      <TherapyLibrary
        clientId={clientId}
        recommendedTherapies={recommendedTherapies}
        libraryTherapies={LIBRARY_THERAPIES}
        defaultLanguage={defaultLanguage}
        activeTreatmentPlanId={activePlan?.id ?? null}
        clientHasContactPhone={clientHasContactPhone}
        clientHasContactEmail={clientHasContactEmail}
      />
      <WorkflowSection clientId={clientId} />
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
