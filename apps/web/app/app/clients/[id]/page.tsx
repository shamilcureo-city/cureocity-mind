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
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { DiagnosisHistoryCard } from '@/components/app/DiagnosisHistoryCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InstrumentRunner } from '@/components/app/InstrumentRunner';
import { JourneyHeader } from '@/components/app/JourneyHeader';
import { PreSessionBriefCard } from '@/components/app/PreSessionBriefCard';
import { TherapyLibrary } from '@/components/app/TherapyLibrary';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

/**
 * Library of therapies always available in the Therapy Library card,
 * even when the active ClinicalReport hasn't surfaced any
 * recommendations yet. Kept as a small static list — Sprint 17+ will
 * pull from a richer evidence-based catalog if needed.
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

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client detail page — the Case Workspace (Sprint 22).
 *
 * Restructured from a flat stack of cards into a decision surface +
 * supporting evidence:
 *   1. Identity — name, status, age, contact, presenting concerns
 *   2. Case Briefing (the anchor) — what's going on (5 Ps), what's still
 *      open (the running differential), the next 1-3 actions, and when to
 *      see the client again. Server-rendered deterministically; the panel
 *      offers a Pass-6 "Refresh" for the LLM narrative.
 *   — "Clinical record & evidence" divider —
 *   3. Journey (measured progress) · Pre-session brief · Diagnosis history
 *      · Workflow · Instruments · Therapy library · Affect · Data rights ·
 *      every session. These are the data the briefing is built from.
 *
 * Auth: the WorkflowSection / AffectCard endpoints they hit are
 * already requirePsychologistId-gated, so cross-tenant attempts to
 * load by client id surface as empty cards rather than data leakage.
 * The session-list query here uses the same psychologist scope.
 */
export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Dev shortcut: read the seeded dev user. Sprint 12 hardens this
  // into a middleware check.
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

  // Surface recommended therapies from the most recent completed
  // ClinicalReport. If none exists yet, fall back to an empty list —
  // the LIBRARY_THERAPIES set is always available.
  const [latestReport, activePlan, diagnoses] = await Promise.all([
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
  ]);
  const recommendedTherapies = extractRecommended(latestReport?.body);
  const langParse = ClinicalLocaleSchema.safeParse(client.preferredLanguage);
  const defaultLanguage: ClinicalLocale = langParse.success ? langParse.data : 'en';

  // Sprint 20 — measurement-based-care journey summary. Composed from the
  // cumulative tables; never blocks the page (a derivation error just
  // hides the band).
  const journey = await computeClientJourney(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });

  // Sprint 22 — the Case Briefing: the single synthesis that anchors the
  // workspace (what's going on · what's still open · do next · when to
  // return). Deterministic server render; the panel offers a Pass-6
  // "Refresh" for the LLM narrative. Never blocks the page.
  const briefing = await buildDeterministicCaseBriefing(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });

  const age = client.dateOfBirth ? calcAge(client.dateOfBirth) : null;
  const completedSessions = client.sessions.filter((s) => s.status === 'COMPLETED').length;

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

        <section className="mt-6">
          <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Presenting concerns
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">
            {client.presentingConcerns?.trim() || 'No presenting concerns recorded yet.'}
          </p>
        </section>
      </Card>

      {/* Episode-of-care flow — makes the clinical arc visible at the top. */}
      <div className="mt-6">
        <EpisodeStepper journey={journey} sessionsCompleted={completedSessions} />
      </div>

      {/* The decision surface. Everything below it is the evidence the
          briefing is built from, grouped into three collapsible
          sections so the page reads as ONE anchor + ONE details
          surface, not a stack of cards. */}
      {briefing && (
        <div className="mt-6">
          <CaseBriefingPanel
            clientId={client.id}
            clientName={client.fullName}
            initialBriefing={briefing}
          />
        </div>
      )}

      <div className="mt-10 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
          Clinical record &amp; evidence
        </h2>
        <span className="h-px flex-1 bg-[var(--color-line-soft)]" aria-hidden />
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink-3)]">
        Everything the briefing is built from. Expand a section when you need it.
      </p>

      {/* Section 1 — measured progress (open by default; this is the
          most-glanced surface on follow-up visits). */}
      <details
        open
        className="group mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-white/40"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span>
            <span className="text-sm font-semibold text-[var(--color-ink)]">Measured progress</span>
            <span className="ml-2 text-xs text-[var(--color-ink-3)]">
              Journey · instruments · affect
            </span>
          </span>
          <span
            aria-hidden
            className="text-[var(--color-ink-3)] transition-transform group-open:rotate-90"
          >
            ▸
          </span>
        </summary>
        <div className="space-y-6 border-t border-[var(--color-line-soft)] p-5">
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
      </details>

      {/* Section 2 — clinical history (closed by default; opened when
          the therapist needs to trace the diagnosis / plan trail). */}
      <details className="group mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-white/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span>
            <span className="text-sm font-semibold text-[var(--color-ink)]">Clinical history</span>
            <span className="ml-2 text-xs text-[var(--color-ink-3)]">
              Diagnosis · workflow · therapy library
            </span>
          </span>
          <span
            aria-hidden
            className="text-[var(--color-ink-3)] transition-transform group-open:rotate-90"
          >
            ▸
          </span>
        </summary>
        <div className="space-y-6 border-t border-[var(--color-line-soft)] p-5">
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
      </details>

      {/* Section 3 — sessions + ops (closed by default). */}
      <details className="group mt-4 rounded-2xl border border-[var(--color-line-soft)] bg-white/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span>
            <span className="text-sm font-semibold text-[var(--color-ink)]">
              Sessions &amp; data
            </span>
            <span className="ml-2 text-xs text-[var(--color-ink-3)]">
              {client.sessions.length} session{client.sessions.length === 1 ? '' : 's'} ·
              pre-session brief · data rights
            </span>
          </span>
          <span
            aria-hidden
            className="text-[var(--color-ink-3)] transition-transform group-open:rotate-90"
          >
            ▸
          </span>
        </summary>
        <div className="space-y-6 border-t border-[var(--color-line-soft)] p-5">
          <PreSessionBriefCard clientId={client.id} />
          <Card className="overflow-hidden">
            <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Sessions
              </h3>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                {client.sessions.length} session{client.sessions.length === 1 ? '' : 's'} recorded.
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
                      <span className="text-[var(--color-ink-2)]">{s.modality}</span>
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
      </details>
    </Container>
  );
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
