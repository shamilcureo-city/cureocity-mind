import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AffectCard } from '@/components/app/AffectCard';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { EpisodeStepper } from '@/components/app/EpisodeStepper';
import { InstrumentRunner } from '@/components/app/InstrumentRunner';
import { JourneyHeader } from '@/components/app/JourneyHeader';
import { PageCrisisBanner } from '@/components/app/PageCrisisBanner';
import { PreSessionBriefCard } from '@/components/app/PreSessionBriefCard';
import { TodayStrip } from '@/components/app/TodayStrip';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError, computeClientJourney } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client detail page — the cross-session browse surface (Sprint 26).
 *
 * Holds everything that is about the client *over time*: identity,
 * the episode-of-care arc, today-strip glance state, journey verdict
 * + discharge/share affordances, instruments tracked across sessions,
 * affect trend, the pre-session brief for the next visit, the
 * sessions list, and DSR controls.
 *
 * The AI decision-support layer (Case Briefing, Conceptual Map,
 * Diagnosis history, Therapy Library, Workflow) is NOT rendered
 * here — it lives inside the session page's AI Copilot tab where
 * therapists can engage with it (or ignore it) on a session-by-
 * session basis. See `apps/web/components/app/AICopilotTab.tsx`.
 *
 * Auth: every downstream component already enforces tenant gating
 * via `requirePsychologistId`. The page-level query filters by
 * `psychologistId` so cross-tenant URL probing returns 404.
 */
export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;

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

  const journey = await computeClientJourney(client.id, therapist.id).catch((e) => {
    if (e instanceof JourneyError) return null;
    throw e;
  });
  // TodayStrip + PageCrisisBanner read briefing.cadence + .safety +
  // .openItems — those signals are about the client, not about
  // copilot, so we still derive the briefing server-side for the
  // glance bands. The full panel renders inside AI Copilot.
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

      {journey && (
        <div className="mt-6">
          <JourneyHeader
            journey={journey}
            clientName={client.fullName}
            clientHasContactPhone={!!client.contactPhone}
            clientHasContactEmail={!!client.contactEmail}
          />
        </div>
      )}

      <div className="mt-6" id="instruments">
        <InstrumentRunner clientId={client.id} />
      </div>

      <div className="mt-6">
        <AffectCard clientId={client.id} />
      </div>

      <div className="mt-6">
        <PreSessionBriefCard clientId={client.id} />
      </div>

      <div className="mt-6">
        <Card className="overflow-hidden">
          <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Sessions</h3>
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
                    <span className="text-[var(--color-ink)]">{formatDateTime(s.scheduledAt)}</span>
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
      </div>

      <div className="mt-6">
        <DataRightsCard clientId={client.id} clientName={client.fullName} />
      </div>
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
