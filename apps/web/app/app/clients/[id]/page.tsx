import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientAICopilotTab } from '@/components/app/ClientAICopilotTab';
import type { ClientCopilotSubKey } from '@/components/app/ClientAICopilotSubTabs';
import { ClientWorkspaceTabs, type ClientTabKey } from '@/components/app/ClientWorkspaceTabs';
import { DataRightsCard } from '@/components/app/DataRightsCard';
import { PageCrisisBanner } from '@/components/app/PageCrisisBanner';
import { buildDeterministicCaseBriefing } from '@/lib/case-briefing';
import { JourneyError } from '@/lib/journey';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; sub?: string }>;
}

const VALID_TABS: ReadonlySet<ClientTabKey> = new Set(['record', 'copilot']);
const VALID_SUBS: ReadonlySet<ClientCopilotSubKey> = new Set([
  'journey',
  'briefing',
  'measures',
  'formulation',
]);

function parseTab(raw: string | undefined): ClientTabKey {
  return raw && (VALID_TABS as ReadonlySet<string>).has(raw) ? (raw as ClientTabKey) : 'record';
}

function parseSub(raw: string | undefined): ClientCopilotSubKey {
  return raw && (VALID_SUBS as ReadonlySet<string>).has(raw)
    ? (raw as ClientCopilotSubKey)
    : 'journey';
}

/**
 * Client detail page — Sprint 27 `Record | AI Copilot` split.
 *
 * The **Record** tab is the bare administrative record every
 * therapist needs: identity, the sessions list, and DSR controls.
 * The **AI Copilot** tab holds all client-level decision-support
 * (journey, case briefing, instruments + affect, conceptual map,
 * diagnosis history, therapy library, workflow) behind one opt-in
 * surface — see `ClientAICopilotTab`.
 *
 * `PageCrisisBanner` is the one safety exception: it renders at the
 * page level, above the tabs, so an active crisis flag is visible
 * to a documentation-only therapist who never opens the copilot.
 *
 * Auth: every downstream component enforces tenant gating via
 * `requirePsychologistId`; the page query filters by
 * `psychologistId` so cross-tenant URL probing returns 404.
 */
export default async function ClientDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab: rawTab, sub: rawSub } = await searchParams;
  const tab = parseTab(rawTab);
  const sub = parseSub(rawSub);

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

  // Built once for the page-level crisis banner; reused by the
  // copilot's Journey/Briefing sub-tabs so they don't rebuild it.
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

      {/* Safety: always visible, regardless of the active tab. */}
      <PageCrisisBanner briefing={briefing} />

      <div className="mt-4">
        <ClientWorkspaceTabs clientId={client.id} active={tab} />
      </div>

      <div className="mt-6">
        {tab === 'record' ? (
          <RecordTab
            client={{
              id: client.id,
              fullName: client.fullName,
              status: client.status,
              preferredModality: client.preferredModality,
              contactPhone: client.contactPhone,
              contactEmail: client.contactEmail,
              presentingConcerns: client.presentingConcerns,
              createdAt: client.createdAt,
              age,
            }}
            sessions={client.sessions}
          />
        ) : (
          <ClientAICopilotTab
            clientId={client.id}
            psychologistId={therapist.id}
            clientName={client.fullName}
            clientHasContactPhone={!!client.contactPhone}
            clientHasContactEmail={!!client.contactEmail}
            preferredLanguage={client.preferredLanguage}
            sessionsCompleted={completedSessions}
            briefing={briefing}
            sub={sub}
          />
        )}
      </div>
    </Container>
  );
}

interface RecordClient {
  id: string;
  fullName: string;
  status: string;
  preferredModality: string | null;
  contactPhone: string;
  contactEmail: string | null;
  presentingConcerns: string | null;
  createdAt: Date;
  age: number | null;
}

interface RecordSession {
  id: string;
  modality: string | null;
  status: string;
  scheduledAt: Date;
  therapyNote: { id: string } | null;
  noteDraft: { status: string } | null;
}

function RecordTab({ client, sessions }: { client: RecordClient; sessions: RecordSession[] }) {
  return (
    <>
      <Card className="p-7">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl">{client.fullName}</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {client.age !== null ? `${client.age} years` : 'Age not recorded'}
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
        <Card className="overflow-hidden">
          <header className="border-b border-[var(--color-line-soft)] px-5 py-4">
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Sessions</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              {sessions.length} session{sessions.length === 1 ? '' : 's'} recorded.
            </p>
          </header>
          {sessions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
              No sessions yet. Start one from the Record tab.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {sessions.map((s) => (
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
    </>
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
