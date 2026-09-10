import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientEditPanel } from '@/components/app/ClientEditPanel';
import { ArchivePatientButton } from '@/components/app/ArchivePatientButton';
import { DemoClientButton } from '@/components/app/DemoClientButton';
import { SendCheckinButton } from '@/components/app/SendCheckinButton';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { LetterComposer } from '@/components/app/LetterComposer';
import { ProblemList } from '@/components/app/ProblemList';
import { PageCrisisBanner } from '@/components/app/PageCrisisBanner';
import { ClientWorkspaceNav } from '@/components/app/ClientWorkspaceNav';
import { PreparePanel } from '@/components/app/PreparePanel';
import { MindCareRecordPanel } from '@/components/app/MindCareRecordPanel';
import { ScheduleSessionPanel } from '@/components/app/ScheduleSessionPanel';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { resolveClientPii } from '@/lib/client-pii';
import { formatIstDateTime } from '@/lib/ist';
import { prisma } from '@/lib/prisma';
import { mindSessionDestination, mindStartEntryHref } from '@/lib/mind-session-start';
import { clientSessionSummary } from '@/lib/client-session-summary';
import { buildMindClientOverview } from '@/lib/mind-client-overview';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client detail page — the lean administrative record (Sprint 28).
 *
 * Identity, the sessions list, and DSR controls. That's it. All the
 * decision-support — care journey, case briefing, instruments,
 * affect, conceptual map, diagnosis history, therapy library,
 * workflow — lives on the *session* page's AI Copilot tab, the
 * therapist's primary workspace. Open any session to reach it.
 *
 * `PageCrisisBanner` is the one safety exception: it renders at the
 * top so an active crisis flag is visible even on this lean record.
 *
 * Auth: every downstream component enforces tenant gating via
 * `requirePsychologistId`; the page query filters by
 * `psychologistId` so cross-tenant URL probing returns 404.
 */
export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');

  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
    include: {
      sessions: {
        orderBy: { scheduledAt: 'desc' },
        select: {
          id: true,
          modality: true,
          status: true,
          captureMode: true,
          mindDocumentationMode: true,
          scheduledAt: true,
          therapyNote: { select: { id: true, locked: true, signedAt: true } },
          noteDraft: { select: { status: true } },
        },
      },
    },
  });
  if (!client) notFound();
  const pii = await resolveClientPii(client);
  const defaultCapture =
    therapist.defaultCaptureMode && therapist.defaultCaptureMode !== 'LIVE' ? 'BATCH' : 'LIVE';
  const [journey, activeHomework] = await Promise.all([
    computeClientJourney(client.id, therapist.id),
    prisma.exerciseAssignment.findMany({
      where: { clientId: client.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 3,
      select: {
        id: true,
        exerciseId: true,
        customDescription: true,
        status: true,
        dueAt: true,
      },
    }),
  ]);
  const {
    latestCompletedSession,
    nextAppointment,
    recentSessions,
    completedCount,
    totalRecordCount,
  } = buildMindClientOverview(client.sessions);

  // Built only for the page-level crisis banner — the one clinical
  // signal that stays on the lean record for safety.
  const briefing = await buildDeterministicCaseBriefing(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });

  const age = client.dateOfBirth ? calcAge(client.dateOfBirth) : null;

  // Sprint 65b — only offer the discharge/treatment summary once the
  // client has at least one episode of care.
  const latestEpisode = await prisma.treatmentEpisode.findFirst({
    where: { clientId: client.id },
    orderBy: { openedAt: 'desc' },
    select: { status: true },
  });
  const episodeClosed =
    latestEpisode?.status === 'DISCHARGED' || latestEpisode?.status === 'TRANSFERRED';

  // Sprint 67c — the maintained problem list.
  const problems = await prisma.problemListItem.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      detail: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  const initialProblems = problems.map((p) => ({
    id: p.id,
    title: p.title,
    detail: p.detail,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    resolvedAt: p.resolvedAt?.toISOString() ?? null,
  }));

  // Sprint 73 — how many sessions have worked on each problem (thread the
  // problem across the case).
  const problemIds = problems.map((p) => p.id);
  const linkCounts =
    problemIds.length > 0
      ? await prisma.sessionProblemLink.groupBy({
          by: ['problemListItemId'],
          where: { problemListItemId: { in: problemIds } },
          _count: { sessionId: true },
        })
      : [];
  const sessionCounts: Record<string, number> = {};
  for (const g of linkCounts) sessionCounts[g.problemListItemId] = g._count.sessionId;

  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app/clients" className="hover:text-[var(--color-ink)]">
          ← All clients
        </Link>
      </p>

      {/* Safety: active crisis flags surface even on the lean record. */}
      <PageCrisisBanner briefing={briefing} />

      <div className="mt-4">
        <Card className="p-7">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-3 font-serif text-3xl">
                {pii.fullName || (
                  <span className="italic text-[var(--color-ink-3)]">Name unavailable</span>
                )}
                {!pii.fullName && <Badge tone="warn">Contact support to restore name</Badge>}
                {client.isDemo && <Badge tone="warn">Example</Badge>}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                {age !== null ? `${age} years` : 'Age not recorded'}
                {' · '}
                Client since {formatMonth(client.createdAt)}
              </p>
              {client.isDemo && (
                <p className="mt-2 max-w-xl text-xs text-[var(--color-ink-3)]">
                  This is a seeded example — fabricated for the demo. Sessions, instruments, and the
                  shared progress report are real records you can click through, but they
                  don&rsquo;t count toward your trial allowance or practice metrics.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {therapist.vertical === 'THERAPIST' && (
                <Link
                  href={mindStartEntryHref({
                    source: 'CLIENT',
                    clientId: client.id,
                    captureMode: defaultCapture,
                  })}
                  className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]"
                >
                  Start session
                </Link>
              )}
              <ScheduleSessionPanel
                clients={[
                  {
                    id: client.id,
                    fullName: pii.fullName,
                    preferredModality: client.preferredModality,
                  },
                ]}
                initialClientId={client.id}
                triggerLabelOverride="Schedule follow-up"
              />
              <details className="w-full text-right">
                <summary className="cursor-pointer py-2 text-sm text-[var(--color-ink-2)]">
                  Client settings
                </summary>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Badge tone={client.status === 'ACTIVE' ? 'accent' : 'muted'}>
                    {client.status}
                  </Badge>
                  {client.preferredModality && (
                    <Badge tone="muted">{client.preferredModality}</Badge>
                  )}
                  {client.isDemo && <DemoClientButton demoClientId={client.id} variant="inline" />}
                  <SendCheckinButton
                    clientId={client.id}
                    hasContactPhone={!!pii.contactPhone}
                    hasContactEmail={!!pii.contactEmail}
                  />
                  <ClientEditPanel
                    client={{
                      id: client.id,
                      fullName: pii.fullName,
                      contactPhone: pii.contactPhone,
                      contactEmail: pii.contactEmail,
                      dateOfBirth: client.dateOfBirth
                        ? client.dateOfBirth.toISOString().slice(0, 10)
                        : null,
                      presentingConcerns: client.presentingConcerns,
                      preferredLanguage: client.preferredLanguage,
                      spokenLanguages: client.spokenLanguages,
                    }}
                  />
                  <ArchivePatientButton
                    clientId={client.id}
                    redirectTo="/app/clients"
                    noun="client"
                    name={pii.fullName}
                  />
                </div>
              </details>
            </div>
          </header>

          {/* UI truth pass — one empty-value treatment: a muted em-dash. A bare
              "Phone" label with nothing under it read as a rendering bug. */}
          <details className="mt-4">
            <summary className="cursor-pointer py-2 text-sm text-[var(--color-ink-2)]">
              Contact details
            </summary>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[var(--color-ink-3)]">Phone</dt>
                <dd className="font-mono text-[var(--color-ink)]">
                  {pii.contactPhone || <span className="text-[var(--color-ink-3)]">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-ink-3)]">Email</dt>
                <dd className="text-[var(--color-ink)]">
                  {pii.contactEmail || <span className="text-[var(--color-ink-3)]">—</span>}
                </dd>
              </div>
            </dl>
          </details>

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
      </div>

      <div className="mt-4">
        <ClientWorkspaceNav clientId={client.id} />
      </div>
      <Card className="mt-5 p-5">
        <h2 className="mb-4 font-serif text-xl">For the next session</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Next appointment
            </p>
            <p className="mt-1 font-medium">
              {nextAppointment ? formatDateTime(nextAppointment.scheduledAt) : 'Not booked'}
            </p>
          </section>
          <section>
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Last completed session
            </p>
            <p className="mt-1 text-sm">
              {latestCompletedSession
                ? formatDateTime(latestCompletedSession.scheduledAt)
                : 'None yet'}
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">
              {journey.instrumentChanges[0]
                ? `${journey.instrumentChanges[0].instrumentKey} ${journey.instrumentChanges[0].baselineScore}→${journey.instrumentChanges[0].latestScore}`
                : 'No outcome change recorded yet'}
            </p>
          </section>
          <section>
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Homework</p>
            <p className="mt-1 text-sm">
              {activeHomework.length > 0
                ? `${activeHomework.length === 3 ? 'At least ' : ''}${activeHomework.length} active assignment${activeHomework.length === 1 ? '' : 's'}`
                : 'Nothing active'}
            </p>
          </section>
          <section>
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Record-based suggestion · clinician review
            </p>
            <p className="mt-1 text-sm font-medium">
              {journey.nextBestAction?.title ?? 'No next step suggested'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-2)]">
              Based on the saved record, not a confirmed clinical outcome. Check its fit with the
              client today; no diagnosis or action is required to finish a session.
            </p>
            <Link
              href={`/app/clients/${client.id}/journey`}
              className="mt-1 inline-block py-2 text-xs text-[var(--color-accent)] underline"
            >
              Review supporting care context
            </Link>
          </section>
        </div>
        <div id="prepare">
          <PreparePanel clientId={client.id} summaryVisible />
        </div>
      </Card>

      <MindCareRecordPanel key={client.id} clientId={client.id} />

      <div className="mt-6">
        <Card className="p-5">
          <details>
            <summary className="cursor-pointer py-2 text-sm font-medium">
              Ongoing concerns ·{' '}
              {initialProblems.filter((problem) => problem.status !== 'RESOLVED').length} unresolved
            </summary>
            <p className="mb-3 mt-1 text-sm text-[var(--color-ink-2)]">
              The main difficulties you&apos;re working on — your own running list, kept across
              sessions.
            </p>
            <ProblemList
              clientId={client.id}
              initialItems={initialProblems}
              sessionCounts={sessionCounts}
            />
          </details>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-soft)] px-5 py-4">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                Recent session records
              </h3>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                {completedCount} completed session{completedCount === 1 ? '' : 's'} ·{' '}
                {totalRecordCount} total appointments and session records.
              </p>
            </div>
            <Link
              href={`/app/clients/${client.id}/sessions`}
              className="rounded-full border border-[var(--color-line)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]"
            >
              View all sessions →
            </Link>
          </header>
          {recentSessions.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[var(--color-ink-2)]">
                No recent session records yet. Your next booked appointment is shown above.
              </p>
              <p className="mt-3 text-xs text-[var(--color-ink-3)]">
                Use Start session above when you are ready.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={mindSessionDestination({ ...s, clientId: client.id }, defaultCapture)}
                    className="grid grid-cols-2 gap-3 px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)] sm:grid-cols-[1.5fr_1fr_1.5fr_1fr]"
                  >
                    <span className="text-[var(--color-ink)]">{formatDateTime(s.scheduledAt)}</span>
                    <span className="text-[var(--color-ink-2)]">{s.modality ?? '—'}</span>
                    <span className="text-[var(--color-ink-2)]">
                      {clientSessionSummary(s.status, s.therapyNote, s.noteDraft)}
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
      </div>

      <details className="mt-6 rounded-2xl border border-[var(--color-line)] bg-white p-5">
        <summary className="cursor-pointer py-2 text-sm font-medium">
          Documents &amp; data rights
        </summary>
        <div className="mt-4">
          <Card className="p-5">
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Case documents
            </h3>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              The whole chart — diagnoses, plan, scores and session history — as one PDF, for a
              referral, supervision, or the client&apos;s own records.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`/api/v1/clients/${client.id}/case-file/pdf`}
                className="inline-block rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                Download case file (PDF)
              </a>
              {latestEpisode && (
                <a
                  href={`/api/v1/clients/${client.id}/discharge-summary/pdf`}
                  className="inline-block rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                  {episodeClosed
                    ? 'Download discharge summary (PDF)'
                    : 'Download treatment summary (PDF)'}
                </a>
              )}
              <LetterComposer clientId={client.id} />
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <DataRightsCard clientId={client.id} clientName={pii.fullName} />
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
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatDateTime(d: Date): string {
  // UI truth pass — same clock as the session pages (IST), not server-UTC.
  return formatIstDateTime(d);
}

function statusTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'muted';
  return 'default';
}
