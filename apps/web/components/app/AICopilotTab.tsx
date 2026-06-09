import {
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  type ClinicalLocale,
  type SessionKind,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { Card } from '@/components/ui/Card';
import { CaseBriefingPanel } from '@/components/app/CaseBriefingPanel';
import { ClinicalBriefTab } from '@/components/app/ClinicalBriefTab';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { InitialAssessmentTab } from '@/components/app/InitialAssessmentTab';
import { MindmapTab } from '@/components/app/MindmapTab';
import { ReflectionTab } from '@/components/app/ReflectionTab';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { AICopilotSubTabs, type CopilotSubKey } from '@/components/app/AICopilotSubTabs';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { readInitialAssessmentBrief, toClinicalReport } from '@/lib/clinical-mappers';
import { JourneyError } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

interface Props {
  sessionId: string;
  clientId: string;
  clientName: string;
  psychologistId: string;
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
 * Sprint 26 — single host for every AI decision-support surface.
 *
 * Renders the secondary sub-tab nav and dispatches to one of three
 * sub-views: the Case Briefing synthesis (cross-session, the
 * default), the per-session AI outputs (Clinical Brief / Initial
 * Assessment + Mindmap + Reflection), or the cross-session
 * surfaces (Conceptual Map + Diagnosis history + Therapy Library +
 * Workflow).
 *
 * Data loading is sub-aware — `briefing` only fetches the case
 * briefing, `session` only fetches the per-session note/report,
 * `client` only fetches the cross-session shape. Other tabs (Notes
 * / Transcript / Session Info) don't pay any of this cost because
 * the panel isn't mounted unless `tab=copilot`.
 */
export async function AICopilotTab({
  sessionId,
  clientId,
  clientName,
  psychologistId,
  preferredLanguage,
  sessionKind,
  sub,
}: Props) {
  return (
    <div className="space-y-6">
      <AICopilotSubTabs sessionId={sessionId} active={sub} />
      {sub === 'briefing' && (
        <BriefingSub clientId={clientId} clientName={clientName} psychologistId={psychologistId} />
      )}
      {sub === 'session' && (
        <SessionSub sessionId={sessionId} clientId={clientId} sessionKind={sessionKind} />
      )}
      {sub === 'client' && (
        <ClientSub clientId={clientId} preferredLanguage={preferredLanguage} />
      )}
    </div>
  );
}

// ----- sub-tab bodies -----

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
  const [reportRow, draft, signed] = await Promise.all([
    prisma.clinicalReport.findUnique({ where: { sessionId } }),
    prisma.noteDraft.findUnique({ where: { sessionId }, select: { content: true } }),
    prisma.therapyNote.findUnique({ where: { sessionId }, select: { content: true } }),
  ]);
  const noteJson = (signed?.content ?? draft?.content) as TherapyNoteV1 | null;

  if (isIntake) {
    const envelope = reportRow
      ? { status: reportRow.status, errorMessage: reportRow.errorMessage }
      : null;
    const brief = reportRow ? readInitialAssessmentBrief(reportRow) : null;
    return (
      <InitialAssessmentTab
        sessionId={sessionId}
        clientId={clientId}
        reportEnvelope={envelope}
        initialBrief={brief}
      />
    );
  }

  const initialReport = reportRow ? toClinicalReport(reportRow) : null;
  return (
    <div className="space-y-8">
      <ClinicalBriefTab sessionId={sessionId} initialReport={initialReport} />
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
          <ReflectionTab sessionId={sessionId} clientId={clientId} note={noteJson} />
        </section>
      )}
    </div>
  );
}

async function ClientSub({
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
