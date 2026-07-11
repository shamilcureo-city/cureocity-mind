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
import { AffectCard } from '@/components/app/AffectCard';
import { CaseBriefingPanel } from '@/components/app/CaseBriefingPanel';
import { CaseConsultPanel } from '@/components/app/CaseConsultPanel';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import {
  CopilotDecisionBoard,
  type CaseRecordSnapshot,
} from '@/components/app/CopilotDecisionBoard';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InstrumentRunner } from '@/components/app/InstrumentRunner';
import { JourneyHeader } from '@/components/app/JourneyHeader';
import { MindmapTab } from '@/components/app/MindmapTab';
import { PreSessionBriefCard } from '@/components/app/PreSessionBriefCard';
import { ReflectionTab } from '@/components/app/ReflectionTab';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { TodayStrip } from '@/components/app/TodayStrip';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { AICopilotSubTabs, type CopilotSubKey } from '@/components/app/AICopilotSubTabs';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';
import { JourneyError, computeClientJourney } from '@/lib/journey';
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
 * Sprint 28 — the session AI Copilot is the *full* copilot.
 *
 * The session page is the therapist's primary workspace, so the
 * whole decision-support layer lives here behind one opt-in tab,
 * grouped into five sub-tabs by altitude:
 *
 * - **This session** — this recording's AI analysis (Clinical Brief
 *   / Initial Assessment + Mindmap + Reflection). The default.
 * - **Journey** — care-of-episode stage, Next-Best-Action,
 *   discharge/share, pre-session brief.
 * - **Case Briefing** — the cross-session synthesis.
 * - **Measures** — instruments + affect trend.
 * - **Formulation & Plan** — conceptual map, diagnosis history,
 *   therapy library, workflow.
 *
 * Loading is sub-aware: each sub-tab fetches only what it renders,
 * so a therapist who only opens "This session" never pays for the
 * journey/briefing/formulation queries. The client page is a lean
 * record and carries none of this.
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
      {sub === 'session' && (
        <SessionSub
          sessionId={sessionId}
          clientId={clientId}
          sessionKind={sessionKind}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
        />
      )}
      {sub === 'journey' && (
        <JourneySub
          clientId={clientId}
          psychologistId={psychologistId}
          clientName={clientName}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
        />
      )}
      {sub === 'briefing' && (
        <BriefingSub clientId={clientId} clientName={clientName} psychologistId={psychologistId} />
      )}
      {sub === 'measures' && (
        <div className="space-y-6">
          <InstrumentRunner clientId={clientId} />
          <AffectCard clientId={clientId} />
        </div>
      )}
      {sub === 'formulation' && (
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
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  sessionId: string;
  clientId: string;
  sessionKind: SessionKind;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
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
      {!isIntake && noteJson && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Mindmap
          </h3>
          <MindmapTab note={noteJson} />
        </section>
      )}
      {!isIntake && noteJson && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Reflection questions
          </h3>
          <ReflectionTab
            sessionId={sessionId}
            clientId={clientId}
            note={noteJson}
            clientHasContactPhone={clientHasContactPhone}
            clientHasContactEmail={clientHasContactEmail}
          />
        </section>
      )}
    </div>
  );
}

async function JourneySub({
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
}: {
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
}) {
  const [journey, briefing, sessionsCompleted] = await Promise.all([
    computeClientJourney(clientId, psychologistId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
    buildDeterministicCaseBriefing(clientId, psychologistId).catch((e) => {
      if (e instanceof JourneyError) return null;
      throw e;
    }),
    prisma.session.count({ where: { clientId, status: 'COMPLETED' } }),
  ]);
  return (
    <div>
      <EpisodeStepper journey={journey} sessionsCompleted={sessionsCompleted} />
      <TodayStrip journey={journey} briefing={briefing} />
      {journey && (
        <div className="mt-6">
          <JourneyHeader
            journey={journey}
            clientName={clientName}
            clientHasContactPhone={clientHasContactPhone}
            clientHasContactEmail={clientHasContactEmail}
          />
        </div>
      )}
      <div className="mt-6">
        <PreSessionBriefCard clientId={clientId} />
      </div>
    </div>
  );
}

async function BriefingSub({
  clientId,
  clientName,
  psychologistId,
}: {
  clientId: string;
  clientName: string;
  psychologistId: string;
}) {
  const briefing = await buildDeterministicCaseBriefing(clientId, psychologistId).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });
  if (!briefing) {
    return (
      <EmptyState
        title="No case briefing yet"
        body="The briefing is composed from the cumulative client record. As sessions and assessments accumulate, it appears here."
      />
    );
  }
  return (
    <div className="space-y-6">
      <CaseBriefingPanel clientId={clientId} clientName={clientName} initialBriefing={briefing} />
      {/* Sprint 52 — Case Consult sits alongside the briefing inside
          the Briefing sub-tab. The briefing answers "what is going
          on?", the consult answers "given everything I've tried,
          what should I consider next?". */}
      <CaseConsultPanel clientId={clientId} />
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
