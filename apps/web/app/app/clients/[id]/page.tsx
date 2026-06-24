import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientEditPanel } from '@/components/app/ClientEditPanel';
import { DemoClientButton } from '@/components/app/DemoClientButton';
import { SendCheckinButton } from '@/components/app/SendCheckinButton';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { PageCrisisBanner } from '@/components/app/PageCrisisBanner';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError } from '@/lib/journey';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

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
          therapyNote: { select: { id: true } },
          noteDraft: { select: { status: true } },
        },
      },
    },
  });
  if (!client) notFound();
  const pii = await resolveClientPii(client);

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
                {pii.fullName}
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
            </div>
          </header>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--color-ink-3)]">Phone</dt>
              <dd className="font-mono text-[var(--color-ink)]">{pii.contactPhone}</dd>
            </div>
            {pii.contactEmail && (
              <div>
                <dt className="text-xs text-[var(--color-ink-3)]">Email</dt>
                <dd className="text-[var(--color-ink)]">{pii.contactEmail}</dd>
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
              No sessions yet. Start one from Record in the navigation.
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
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <DataRightsCard clientId={client.id} clientName={pii.fullName} />
      </div>
    </Container>
  );
}

function calcAge(dob: Date): number {
  const ms = Date.now() - dob.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-IN', {
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
