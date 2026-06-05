import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AffectCard } from '@/components/app/AffectCard';
import { WorkflowSection } from '@/components/app/WorkflowSection';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Client detail page. Embeds the same WorkflowSection + AffectCard
 * that the per-session Client tab uses, but without the
 * session-scoped context — this is the standalone clinical record
 * for a single client.
 *
 * Sections (top to bottom):
 *   1. Header — name, status, age, preferred modality
 *   2. Contact + presenting concerns
 *   3. Workflow (modality phase, goals, prescribed exercises) — reused
 *      component so behaviour matches the per-session client tab
 *   4. Affect baseline + recent deviations
 *   5. All sessions list — newest first, links to per-session detail
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

  const age = client.dateOfBirth ? calcAge(client.dateOfBirth) : null;

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

      <div className="mt-6">
        <WorkflowSection clientId={client.id} />
      </div>

      <div className="mt-6">
        <AffectCard clientId={client.id} />
      </div>

      <div className="mt-6">
        <Card className="overflow-hidden">
          <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
            <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
              Sessions
            </h2>
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
