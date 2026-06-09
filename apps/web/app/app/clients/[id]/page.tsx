import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ClinicalLocaleSchema,
  ClinicalReportV1Schema,
  type ClinicalLocale,
} from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AffectCard } from '@/components/app/AffectCard';
import { CaseBriefingPanel } from '@/components/app/CaseBriefingPanel';
import { ClientWorkspaceTabs, type ClientTabKey } from '@/components/app/ClientWorkspaceTabs';
import { ConceptualMapTab } from '@/components/app/ConceptualMapTab';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InstrumentRunner } from '@/components/app/InstrumentRunner';
import { JourneyHeader } from '@/components/app/JourneyHeader';
import { PageCrisisBanner } from '@/components/app/PageCrisisBanner';
import { PreSessionBriefCard } from '@/components/app/PreSessionBriefCard';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { TodayStrip } from '@/components/app/TodayStrip';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

/**
 * Library of therapies always available in the Therapy Library card,
 * even when the active ClinicalReport hasn't surfaced any
 * recommendations yet.
 */
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const VALID_TABS: readonly ClientTabKey[] = ['clinical', 'map', 'progress', 'sessions'] as const;

/**
 * Client detail page — the Case Workspace (Sprint 22, retabbed Sprint 25).
 *
 * Restructured from a stacked accordion into a tabbed workspace.
 * Always rendered above the tab nav:
 *   1. Identity card — name, status, age, contact, presenting concerns
 *   2. Episode-of-care stepper — where the client is in the arc
 *   3. Today strip — next session due · open items · latest instrument
 *   4. Page-level crisis banner — when an active flag warrants it
 *   5. Tab nav (4 peer tabs)
 *
 * The four peer tabs:
 *   - Clinical Engine (default) — Case Briefing + Diagnosis + Workflow + Therapy library
 *   - Conceptual Map           — Sprint-24 force-directed thematic graph
 *   - Progress                 — Journey verdict + Instruments + Affect
 *   - Sessions                 — Sessions list + Pre-session brief + Data rights
 *
 * Auth: every downstream component already enforces tenant gating
 * via `requirePsychologistId`. The page-level query filters by
 * `psychologistId` so cross-tenant URL probing returns 404.
 */
export default async function ClientDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab: ClientTabKey = VALID_TABS.includes(tabParam as ClientTabKey)
    ? (tabParam as ClientTabKey)
    : 'clinical';

  const therapist = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    select: { id: true },
  });
  if (!therapist) notFound();

  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
    include: {
      sessions: {
        orderBy: { scheduledAt: 'desc' },
        select: {
          id: true,
          modality: true,
          status: true,
          scheduledAt: true,
          endedAt: true,
          therapyNote: { select: { id: true } },
          noteDraft: { select: { status: true } },
        },
      },
    },
  });
  if (!client) notFound();

  const [latestReport, activePlan, diagnoses, latestMap] = await Promise.all([
    prisma.clinicalReport.findFirst({
      where: { clientId: client.id, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId: client.id, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true },
    }),
    prisma.clientDiagnosis.findMany({
      where: { clientId: client.id },
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
    // Sprint 25 — Map badge: stale if a session has been completed
    // since the last refresh. Just need the timestamp.
    prisma.clientConceptualMap.findFirst({
      where: { clientId: client.id, supersededAt: null },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    }),
  ]);
  const recommendedTherapies = extractRecommended(latestReport?.body);
  const langParse = ClinicalLocaleSchema.safeParse(client.preferredLanguage);
  const defaultLanguage: ClinicalLocale = langParse.success ? langParse.data : 'en';

  const journey = await computeClientJourney(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });
  const briefing = await buildDeterministicCaseBriefing(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });

  const age = client.dateOfBirth ? calcAge(client.dateOfBirth) : null;
  const completedSessions = client.sessions.filter((s) => s.status === 'COMPLETED').length;

  // Sprint 25 — tab freshness heuristics. No persistence; just absolute
  // recency. `Sessions ●` when a completed session lands today;
  // `Map ↻` when the saved map is older than the latest session.
  const badges = computeBadges(client.sessions, latestMap?.generatedAt ?? null);

  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app/clients" className="hover:text-[var(--color-ink)]">
          ← All clients
        </Link>
      </p>

      <Card className="p-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl">{client.fullName}</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {age !== null ? `${age} years` : 'Age not recorded'}
              {' · '}
              Client since {formatMonth(client.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={client.status === 'ACTIVE' ? 'accent' : 'muted'}>{client.status}</Badge>
            {client.preferredModality && <Badge tone="muted">{client.preferredModality}</Badge>}
          </div>
        </header>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--color-ink-3)]">Phone</dt>
            <dd className="font-mono text-[var(--color-ink)]">{client.contactPhone}</dd>
          </div>
          {client.contactEmail && (
            <div>
              <dt className="text-xs text-[var(--color-ink-3)]">Email</dt>
              <dd className="text-[var(--color-ink)]">{client.contactEmail}</dd>
            </div>
          )}
        </dl>

        {client.presentingConcerns?.trim() && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Presenting concerns
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
              {client.presentingConcerns.trim()}
            </p>
          </section>
        )}
      </Card>

      <div className="mt-6">
        <EpisodeStepper journey={journey} sessionsCompleted={completedSessions} />
      </div>

      <TodayStrip journey={journey} briefing={briefing} />
      <PageCrisisBanner briefing={briefing} />

      <div className="mt-6">
        <ClientWorkspaceTabs clientId={client.id} active={activeTab} badges={badges} />
      </div>

      <div className="mt-6">
        {activeTab === 'clinical' && (
          <div className="space-y-6">
            {briefing && (
              <CaseBriefingPanel
                clientId={client.id}
                clientName={client.fullName}
                initialBriefing={briefing}
              />
            )}
            {diagnoses.length > 0 && <DiagnosisHistoryCard diagnoses={diagnoses} />}
            <WorkflowSection clientId={client.id} />
            <TherapyLibrary
              clientId={client.id}
              recommendedTherapies={recommendedTherapies}
              libraryTherapies={LIBRARY_THERAPIES}
              defaultLanguage={defaultLanguage}
              activeTreatmentPlanId={activePlan?.id ?? null}
            />
          </div>
        )}

        {activeTab === 'map' && <ConceptualMapTab clientId={client.id} />}

        {activeTab === 'progress' && (
          <div className="space-y-6">
            {journey && (
              <JourneyHeader
                journey={journey}
                clientName={client.fullName}
                clientHasContactPhone={!!client.contactPhone}
                clientHasContactEmail={!!client.contactEmail}
              />
            )}
            <div id="instruments" className="scroll-mt-6">
              <InstrumentRunner clientId={client.id} />
            </div>
            <AffectCard clientId={client.id} />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="space-y-6">
            <PreSessionBriefCard clientId={client.id} />
            <Card className="overflow-hidden">
              <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
                <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                  Sessions
                </h3>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                  {client.sessions.length} session{client.sessions.length === 1 ? '' : 's'}{' '}
                  recorded.
                </p>
              </header>
              {client.sessions.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
                  No sessions yet. Start one from the Record tab.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-line-soft)]">
                  {client.sessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/app/sessions/${s.id}`}
                        className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr] gap-3 px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                      >
                        <span className="text-[var(--color-ink)]">
                          {formatDateTime(s.scheduledAt)}
                        </span>
                        <span className="text-[var(--color-ink-2)]">{s.modality ?? '—'}</span>
                        <span className="text-[var(--color-ink-2)]">
                          {sessionSummary(s.status, s.therapyNote, s.noteDraft)}
                        </span>
                        <span className="text-right">
                          <Badge tone={statusTone(s.status)}>{s.status.toLowerCase()}</Badge>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <DataRightsCard clientId={client.id} clientName={client.fullName} />
          </div>
        )}
      </div>
    </Container>
  );
}

function computeBadges(
  sessions: { status: string; endedAt: Date | null }[],
  latestMapAt: Date | null,
): Partial<Record<ClientTabKey, string>> {
  const out: Partial<Record<ClientTabKey, string>> = {};
  const completed = sessions.filter((s) => s.status === 'COMPLETED' && s.endedAt !== null);
  const lastSessionAt = completed[0]?.endedAt ?? null;
  if (lastSessionAt && Date.now() - lastSessionAt.getTime() < ONE_DAY_MS) {
    out.sessions = '●';
  }
  if (lastSessionAt && (!latestMapAt || latestMapAt < lastSessionAt)) {
    out.map = '↻';
  }
  return out;
}

function calcAge(dob: Date): number {
  const ms = Date.now() - dob.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'muted';
  return 'default';
}

function sessionSummary(
  status: string,
  signedNote: { id: string } | null,
  draft: { status: string } | null,
): string {
  if (signedNote) return 'Signed note';
  if (draft?.status === 'COMPLETED') return 'Unsigned draft';
  if (draft?.status === 'IN_PROGRESS') return 'Generating note…';
  if (draft?.status === 'FAILED') return 'Note generation failed';
  if (status === 'IN_PROGRESS') return 'Recording…';
  return '—';
}

function extractRecommended(body: unknown): string[] {
  if (body === null || body === undefined) return [];
  const parsed = ClinicalReportV1Schema.safeParse(body);
  if (!parsed.success) return [];
  return parsed.data.recommendedTherapies.map((t) => t.name);
}
