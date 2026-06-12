import {
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  type ClinicalLocale,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { AffectCard } from '@/components/app/AffectCard';
import { CaseBriefingPanel } from '@/components/app/CaseBriefingPanel';
import { ClinicalBriefTab } from '@/components/app/ClinicalBriefTab';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InitialAssessmentTab } from '@/components/app/InitialAssessmentTab';
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
  const [reportRow, draft, signed] = await Promise.all([
    prisma.clinicalReport.findUnique({ where: { sessionId } }),
    prisma.noteDraft.findUnique({ where: { sessionId }, select: { content: true } }),
    prisma.therapyNote.findUnique({ where: { sessionId }, select: { content: true } }),
  ]);
  const noteJson = (signed?.content ?? draft?.content) as TherapyNoteV1 | null;

  if (isIntake) {
    return (
      <InitialAssessmentTab
        sessionId={sessionId}
        clientId={clientId}
        reportEnvelope={
          reportRow ? { status: reportRow.status, errorMessage: reportRow.errorMessage } : null
        }
        initialBrief={reportRow ? readInitialAssessmentBrief(reportRow) : null}
      />
    );
  }

  return (
    <div className="space-y-8">
      <ClinicalBriefTab
        sessionId={sessionId}
        initialReport={reportRow ? toClinicalReport(reportRow) : null}
      />
      {noteJson && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Mindmap
          </h3>
          <MindmapTab note={noteJson} />
        </section>
      )}
      {noteJson && (
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
    <CaseBriefingPanel clientId={clientId} clientName={clientName} initialBriefing={briefing} />
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
