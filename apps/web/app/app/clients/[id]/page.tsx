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
import { MindClientOverview } from '@/components/app/MindClientOverview';
import { PreparePanel } from '@/components/app/PreparePanel';
import { MindCareRecordPanel } from '@/components/app/MindCareRecordPanel';
import { MindWorkHistory } from '@/components/app/MindWorkHistory';
import { ScheduleSessionPanel } from '@/components/app/ScheduleSessionPanel';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Mind client overview: a read-only, dated view of care continuity,
 * preparation, goals and measures, followed by the existing record controls.
 * Clinical edits remain in their existing client-owned workflows.
 * `PageCrisisBanner` stays above the overview for active safety concerns.
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
    <Container className="py-8 mind-visual-workspace">
      <MindClientOverview
        clientId={client.id}
        name={pii.fullName}
        age={age}
        createdAt={client.createdAt}
        isDemo={client.isDemo}
        presentingConcerns={client.presentingConcerns}
        journey={journey}
        sessions={client.sessions}
        activeHomeworkCount={activeHomework.length}
        defaultCapture={defaultCapture}
        safetyBanner={<PageCrisisBanner briefing={briefing} />}
        navigation={<ClientWorkspaceNav clientId={client.id} />}
        preparationPanel={<PreparePanel clientId={client.id} summaryVisible />}
        scheduleAction={
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
        }
        clientSettings={
          <details>
            <summary className="cursor-pointer py-2 text-sm text-[var(--color-ink-2)]">
              Client settings
            </summary>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Badge tone={client.status === 'ACTIVE' ? 'accent' : 'muted'}>{client.status}</Badge>
              {client.preferredModality && <Badge tone="muted">{client.preferredModality}</Badge>}
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
        }
        contactDetails={
          <details>
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
        }
      >
        <MindCareRecordPanel key={client.id} clientId={client.id} />
        <div id="work-history" className="mt-5 scroll-mt-6">
          <MindWorkHistory key={`work-history-${client.id}`} clientId={client.id} />
        </div>

        <div className="mt-6">
          <Card className="p-5">
            <details>
              <summary className="cursor-pointer py-2 text-sm font-medium">
                Ongoing concerns ·{' '}
                {initialProblems.filter((problem) => problem.status !== 'RESOLVED').length}{' '}
                unresolved
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
      </MindClientOverview>
    </Container>
  );
}

function calcAge(dob: Date): number {
  const ms = Date.now() - dob.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}
