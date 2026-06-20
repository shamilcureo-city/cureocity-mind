import Link from 'next/link';
import type { ReactNode } from 'react';
import type { JourneyStage } from '@cureocity/contracts';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { FirstRunChecklist } from '@/components/app/FirstRunChecklist';
import { PrivacyModeToggle } from '@/components/app/PrivacyModeToggle';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import {
  buildDashboard,
  greetingNameFrom,
  type AttentionData,
  type CaseloadPulse,
  type DashboardData,
  type DashboardMetrics,
  type RecentSessionGroup,
  type UpNextSession,
} from '@/lib/dashboard';
import { istGreeting, formatDayShort, formatIstTime } from '@/lib/ist';

export const dynamic = 'force-dynamic';

/**
 * Sprint 57 — Dashboard ("command center").
 *
 * A calm, action-oriented triage hub that answers "what needs me across my
 * whole caseload right now". The hero is the "Needs your attention" block
 * (crises → deteriorating → unsigned notes → measures due); metrics, caseload
 * pulse, agenda and recent activity follow. Read-only: no audit on view, all
 * data composed server-side via `buildDashboard`.
 */
export default async function DashboardPage() {
  const therapist = await requireOnboardedPsychologist();
  const data = await buildDashboard(therapist.id, greetingNameFrom(therapist.fullName));

  return (
    <Container className="py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Dashboard
          </p>
          <h1 className="mt-1 font-serif text-3xl">
            {istGreeting()}, {data.greetingName}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">{headline(data)}</p>
        </div>
        <PrivacyModeToggle />
      </header>

      {data.isEmpty ? (
        <EmptyState psychologistId={therapist.id} />
      ) : (
        <>
          <AttentionSection attention={data.attention} />
          <MetricStrip metrics={data.metrics} />
          <CaseloadPulseSection pulse={data.caseloadPulse} />
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <UpNextSection upNext={data.upNext} />
            <RecentSection groups={data.recentSessions} />
          </div>
          <QuickActions />
        </>
      )}
    </Container>
  );
}

function headline(data: DashboardData): string {
  const needs =
    data.attention.totals.crises +
    data.attention.totals.deteriorating +
    data.attention.totals.unsignedNotes +
    data.attention.totals.measuresDue;
  const left =
    needs === 0
      ? 'Nothing needs you right now'
      : `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you`;
  return `${left} · ${data.metrics.activeClients} active client${data.metrics.activeClients === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// HERO — Needs your attention.
// ---------------------------------------------------------------------------

function AttentionSection({ attention }: { attention: AttentionData }) {
  const { crises, deteriorating, unsignedNotes, measuresDue, totals } = attention;
  const allClear =
    totals.crises === 0 &&
    totals.deteriorating === 0 &&
    totals.unsignedNotes === 0 &&
    totals.measuresDue === 0;

  if (allClear) {
    return (
      <section aria-label="Needs your attention">
        <Card className="flex items-center gap-3 p-6">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          >
            <CheckGlyph />
          </span>
          <div>
            <p className="font-serif text-lg">All clear</p>
            <p className="text-sm text-[var(--color-ink-2)]">
              No crises, unsigned notes, or overdue measures across your caseload right now.
            </p>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Needs your attention">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Needs your attention
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {totals.crises > 0 && (
          <Bucket title="Open crisis flags" count={totals.crises} tone="warn">
            {crises.map((c, i) => (
              <AttentionRow
                key={`${c.clientId}-${c.kind}-${i}`}
                href={`/app/clients/${c.clientId}`}
                name={c.clientName}
                meta={`${c.kind} · ${c.severity}`}
                tone="warn"
              />
            ))}
            <More total={totals.crises} shown={crises.length} />
          </Bucket>
        )}

        {totals.deteriorating > 0 && (
          <Bucket title="Deteriorating outcomes" count={totals.deteriorating} tone="warn">
            {deteriorating.map((d, i) => (
              <AttentionRow
                key={`${d.clientId}-${d.instrumentKey}-${i}`}
                href={`/app/clients/${d.clientId}#instruments`}
                name={d.clientName}
                meta={`${d.instrumentKey} worsened by ${Math.abs(d.delta)} pt${Math.abs(d.delta) === 1 ? '' : 's'}`}
                tone="warn"
              />
            ))}
            <More total={totals.deteriorating} shown={deteriorating.length} />
          </Bucket>
        )}

        {totals.unsignedNotes > 0 && (
          <Bucket title="Notes waiting to be signed" count={totals.unsignedNotes} tone="accent">
            {unsignedNotes.map((n) => (
              <AttentionRow
                key={n.sessionId}
                href={`/app/sessions/${n.sessionId}`}
                name={n.clientName}
                meta={
                  n.sessionEndedAt
                    ? `Session ${formatDayShort(new Date(n.sessionEndedAt))}`
                    : 'Draft ready'
                }
              />
            ))}
            <More total={totals.unsignedNotes} shown={unsignedNotes.length} />
          </Bucket>
        )}

        {totals.measuresDue > 0 && (
          <Bucket title="Measures &amp; reviews due" count={totals.measuresDue} tone="default">
            {measuresDue.map((m, i) => (
              <AttentionRow
                key={`${m.clientId}-${i}`}
                href={`/app/clients/${m.clientId}#instruments`}
                name={m.clientName}
                meta={
                  m.reason === 'REVIEW_DUE'
                    ? 'Plan due for review'
                    : m.lastAdministeredAt
                      ? `Last measured ${formatDayShort(new Date(m.lastAdministeredAt))}`
                      : 'Measure overdue'
                }
              />
            ))}
            <More total={totals.measuresDue} shown={measuresDue.length} />
          </Bucket>
        )}
      </div>
      {attention.truncated && (
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Showing crises from your {30} most recently-active clients.
        </p>
      )}
    </section>
  );
}

function Bucket({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: 'warn' | 'accent' | 'default';
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-3">
        <h3 className="text-sm font-medium text-[var(--color-ink)]">{title}</h3>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <ul className="divide-y divide-[var(--color-line-soft)]">{children}</ul>
    </Card>
  );
}

function AttentionRow({
  href,
  name,
  meta,
  tone = 'default',
}: {
  href: string;
  name: string;
  meta: string;
  tone?: 'warn' | 'default';
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
      >
        <div className="min-w-0">
          <p className="privacy-blur truncate font-medium text-[var(--color-ink)]">{name}</p>
          <p
            className={`truncate text-xs ${tone === 'warn' ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-3)]'}`}
          >
            {meta}
          </p>
        </div>
        <span aria-hidden className="text-[var(--color-ink-3)]">
          →
        </span>
      </Link>
    </li>
  );
}

function More({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return <li className="px-5 py-2 text-xs text-[var(--color-ink-3)]">+{total - shown} more</li>;
}

// ---------------------------------------------------------------------------
// Metric strip (secondary).
// ---------------------------------------------------------------------------

function MetricStrip({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="At a glance">
      <StatTile label="Active clients" value={metrics.activeClients} />
      <StatTile label="Sessions · 7d" value={metrics.sessionsThisWeek} />
      <StatTile
        label="Unsigned notes"
        value={metrics.unsignedNotes}
        warn={metrics.unsignedNotes > 0}
      />
      <StatTile label="Open crises" value={metrics.openCrises} warn={metrics.openCrises > 0} />
      <StatTile label="Measures due" value={metrics.measuresDue} warn={metrics.measuresDue > 0} />
    </section>
  );
}

function StatTile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <p
        className={`mt-2 font-mono text-3xl tabular-nums ${
          warn ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink)]'
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Caseload pulse (clinical differentiator).
// ---------------------------------------------------------------------------

const STAGE_ORDER: JourneyStage[] = [
  'INTAKE',
  'ASSESSMENT',
  'ACTIVE_TREATMENT',
  'REVIEW_DUE',
  'DISCHARGE_READY',
];
const STAGE_LABEL: Record<JourneyStage, string> = {
  INTAKE: 'Intake',
  ASSESSMENT: 'Assessment',
  ACTIVE_TREATMENT: 'In treatment',
  REVIEW_DUE: 'Review due',
  DISCHARGE_READY: 'Discharge-ready',
  DISCHARGED: 'Discharged',
};
const STAGE_BAR: Record<JourneyStage, string> = {
  INTAKE: 'bg-[var(--color-accent)]/30',
  ASSESSMENT: 'bg-[var(--color-accent)]/50',
  ACTIVE_TREATMENT: 'bg-[var(--color-accent)]/80',
  REVIEW_DUE: 'bg-[var(--color-warn)]',
  DISCHARGE_READY: 'bg-[var(--color-accent)]',
  DISCHARGED: 'bg-[var(--color-ink-3)]',
};

function CaseloadPulseSection({ pulse }: { pulse: CaseloadPulse }) {
  return (
    <section className="mt-8" aria-label="Caseload pulse">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Caseload pulse
      </h2>
      <Card className="p-6">
        {pulse.totalActive === 0 ? (
          <p className="text-sm text-[var(--color-ink-2)]">
            No active episodes of care yet. Start a treatment plan from a client&rsquo;s Clinical
            Brief to begin tracking outcomes here.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-[var(--color-ink-2)]">
                {pulse.totalActive} client{pulse.totalActive === 1 ? '' : 's'} in active care
              </p>
              {pulse.cadenceDrift > 0 && (
                <Badge tone="warn">{pulse.cadenceDrift} not seen in 30d+</Badge>
              )}
            </div>

            {/* Stage distribution bar */}
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
              {STAGE_ORDER.map((stage) => {
                const count = pulse.stageCounts[stage];
                if (count === 0) return null;
                const pct = Math.round((count / pulse.totalActive) * 100);
                return (
                  <div
                    key={stage}
                    className={STAGE_BAR[stage]}
                    style={{ width: `${pct}%` }}
                    title={`${STAGE_LABEL[stage]}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {STAGE_ORDER.filter((s) => pulse.stageCounts[s] > 0).map((stage) => (
                <span
                  key={stage}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]"
                >
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${STAGE_BAR[stage]}`} />
                  {STAGE_LABEL[stage]} · {pulse.stageCounts[stage]}
                </span>
              ))}
            </div>

            {/* Reliable-change rollup */}
            <div className="mt-5 border-t border-[var(--color-line-soft)] pt-4">
              {pulse.change.tracked === 0 ? (
                <p className="text-sm text-[var(--color-ink-3)]">
                  No outcome trends yet — administer PHQ-9 / GAD-7 twice to start tracking change.
                </p>
              ) : (
                <p className="text-sm text-[var(--color-ink)]">
                  <strong className="font-medium text-[var(--color-accent)]">
                    {pulse.change.improving} improving
                  </strong>
                  {' · '}
                  <strong
                    className={`font-medium ${
                      pulse.change.deteriorating > 0
                        ? 'text-[var(--color-warn)]'
                        : 'text-[var(--color-ink-2)]'
                    }`}
                  >
                    {pulse.change.deteriorating} deteriorating
                  </strong>
                  {' · '}
                  <strong className="font-medium text-[var(--color-accent)]">
                    {pulse.change.remission} in remission
                  </strong>
                  <span className="text-[var(--color-ink-3)]">
                    {' '}
                    across {pulse.change.tracked} measured client
                    {pulse.change.tracked === 1 ? '' : 's'}
                  </span>
                </p>
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Up next + recent.
// ---------------------------------------------------------------------------

function UpNextSection({ upNext }: { upNext: UpNextSession[] }) {
  return (
    <section aria-label="Up next">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Up next</h2>
        <Link href="/app/today" className="text-xs text-[var(--color-accent)] hover:underline">
          Full agenda →
        </Link>
      </div>
      {upNext.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-ink-3)]">
          Nothing scheduled in the next 3 days.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {upNext.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/app/sessions/${s.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                >
                  <div className="min-w-0">
                    <p className="privacy-blur truncate font-medium text-[var(--color-ink)]">
                      {s.clientName}
                    </p>
                    <p className="text-xs text-[var(--color-ink-3)]">
                      {formatDayShort(new Date(s.scheduledAt))} · {s.modality ?? 'Modality TBD'}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--color-ink-3)]">
                    {formatIstTime(new Date(s.scheduledAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function RecentSection({ groups }: { groups: RecentSessionGroup[] }) {
  return (
    <section aria-label="Recent sessions">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Recent sessions
      </h2>
      {groups.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-ink-3)]">No completed sessions yet.</Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {groups.flatMap((g) =>
              g.rows.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/sessions/${s.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                  >
                    <div className="min-w-0">
                      <p className="privacy-blur truncate font-medium text-[var(--color-ink)]">
                        {s.clientName}
                      </p>
                      <p className="text-xs text-[var(--color-ink-3)]">{s.modality ?? 'Session'}</p>
                    </div>
                    <span className="text-xs tabular-nums text-[var(--color-ink-3)]">
                      {formatDayShort(new Date(s.scheduledAt))}
                    </span>
                  </Link>
                </li>
              )),
            )}
          </ul>
        </Card>
      )}
    </section>
  );
}

function QuickActions() {
  return (
    <section className="mt-8" aria-label="Quick actions">
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/app" variant="primary" size="sm">
          Start new session
        </ButtonLink>
        <ButtonLink href="/app/clients" variant="secondary" size="sm">
          Clients
        </ButtonLink>
        <ButtonLink href="/app/me" variant="secondary" size="sm">
          My practice
        </ButtonLink>
        <ButtonLink href="/app/templates" variant="secondary" size="sm">
          Templates
        </ButtonLink>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty / first-run.
// ---------------------------------------------------------------------------

function EmptyState({ psychologistId }: { psychologistId: string }) {
  return (
    <>
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">Welcome to your command center</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Once you record sessions and add clients, this is where the day&rsquo;s priorities surface
          — crises, notes to sign, outcomes drifting off track, and your caseload at a glance.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <ButtonLink href="/app" variant="primary">
            Record your first session
          </ButtonLink>
          <ButtonLink href="/app/clients" variant="secondary">
            Add a client
          </ButtonLink>
        </div>
      </Card>
      <div className="mt-8">
        <FirstRunChecklist psychologistId={psychologistId} />
      </div>
    </>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
