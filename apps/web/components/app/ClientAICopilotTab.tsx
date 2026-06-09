import {
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  type CaseBriefingV1,
  type ClinicalLocale,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { AffectCard } from '@/components/app/AffectCard';
import { CaseBriefingPanel } from '@/components/app/CaseBriefingPanel';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InstrumentRunner } from '@/components/app/InstrumentRunner';
import { JourneyHeader } from '@/components/app/JourneyHeader';
import { PreSessionBriefCard } from '@/components/app/PreSessionBriefCard';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { TodayStrip } from '@/components/app/TodayStrip';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import {
  ClientAICopilotSubTabs,
  type ClientCopilotSubKey,
} from '@/components/app/ClientAICopilotSubTabs';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

interface Props {
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  preferredLanguage: string;
  sessionsCompleted: number;
  /// Built once on the page (for the page-level crisis banner) and
  /// passed down so the Journey/Briefing sub-tabs don't rebuild it.
  briefing: CaseBriefingV1 | null;
  sub: ClientCopilotSubKey;
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
 * Sprint 27 — the client-level AI Copilot host.
 *
 * Owns every cross-session decision-support surface ("this person
 * over time"), grouped into four sub-tabs by altitude: Journey
 * (where they are / what's next), Case Briefing (the synthesis),
 * Measures (instruments + affect), Formulation & Plan (map +
 * diagnosis + therapies). The session AI Copilot, by contrast, is
 * strictly per-recording.
 *
 * Loading is sub-aware: each sub-tab fetches only what it renders,
 * so a therapist who only opens "Journey" never pays for the
 * formulation queries.
 */
export async function ClientAICopilotTab({
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  preferredLanguage,
  sessionsCompleted,
  briefing,
  sub,
}: Props) {
  return (
    <div className="space-y-6">
      <ClientAICopilotSubTabs clientId={clientId} active={sub} />
      {sub === 'journey' && (
        <JourneySub
          clientId={clientId}
          psychologistId={psychologistId}
          clientName={clientName}
          clientHasContactPhone={clientHasContactPhone}
          clientHasContactEmail={clientHasContactEmail}
          sessionsCompleted={sessionsCompleted}
          briefing={briefing}
        />
      )}
      {sub === 'briefing' && (
        <BriefingSub clientId={clientId} clientName={clientName} briefing={briefing} />
      )}
      {sub === 'measures' && (
        <div className="space-y-6">
          <InstrumentRunner clientId={clientId} />
          <AffectCard clientId={clientId} />
        </div>
      )}
      {sub === 'formulation' && (
        <FormulationSub clientId={clientId} preferredLanguage={preferredLanguage} />
      )}
    </div>
  );
}

// ----- sub-tab bodies -----

async function JourneySub({
  clientId,
  psychologistId,
  clientName,
  clientHasContactPhone,
  clientHasContactEmail,
  sessionsCompleted,
  briefing,
}: {
  clientId: string;
  psychologistId: string;
  clientName: string;
  clientHasContactPhone: boolean;
  clientHasContactEmail: boolean;
  sessionsCompleted: number;
  briefing: CaseBriefingV1 | null;
}) {
  const journey = await computeClientJourney(clientId, psychologistId).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });
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

function BriefingSub({
  clientId,
  clientName,
  briefing,
}: {
  clientId: string;
  clientName: string;
  briefing: CaseBriefingV1 | null;
}) {
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
}: {
  clientId: string;
  preferredLanguage: string;
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
