import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Record page — the post-login landing surface. Sprint 0 is a static
 * scaffold: three capture-mode cards (the actual recording wiring lands
 * in Sprint 1) plus a real, query-backed session list grouped by date.
 */
export default async function RecordPage() {
  const therapist = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    select: { id: true, fullName: true },
  });
  const sessions = therapist
    ? await prisma.session.findMany({
        where: { psychologistId: therapist.id },
        orderBy: { scheduledAt: 'desc' },
        take: 30,
        include: { client: { select: { fullName: true } } },
      })
    : [];

  const grouped = groupByDate(sessions);

  return (
    <main>
      <Container className="py-10">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Record
          </p>
          <h1 className="mt-2 font-serif text-3xl leading-tight">
            New session — pick how you want to capture it.
          </h1>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <ModeCard
            href="/app?mode=virtual"
            title="Record virtual session"
            body="For web-based platforms like Jane, Owl, and others."
            tone="rose"
            comingSoon
          />
          <ModeCard
            href="/app?mode=in_person"
            title="Record in-person"
            body="Best for recording sessions in person from this device."
            tone="sage"
            comingSoon
          />
          <ModeCard
            href="/app?mode=summary"
            title="Record a summary"
            body="Best for dictating key session notes after a session."
            tone="mint"
            comingSoon
          />
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-xl">Recent sessions</h2>
            <div className="flex items-center gap-2">
              <SearchStub />
              <button
                type="button"
                disabled
                className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm text-[var(--color-ink-3)]"
              >
                Upload
              </button>
            </div>
          </div>

          {grouped.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="font-serif text-xl">No sessions yet.</p>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                Recording lands in Sprint 1. For now, seed data is the only source.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {grouped.map((g) => (
                <div key={g.label}>
                  <p className="mb-2 text-sm font-medium text-[var(--color-ink-2)]">{g.label}</p>
                  <Card className="overflow-hidden">
                    <ul className="divide-y divide-[var(--color-line-soft)]">
                      {g.rows.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/app/sessions/${s.id}`}
                            className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                aria-hidden
                                className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path
                                    d="M5 12l5 5 9-9"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </span>
                              <div>
                                <p className="font-medium">{s.client.fullName}</p>
                                <p className="text-xs text-[var(--color-ink-3)]">
                                  Session · {s.modality}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                              <span className="text-xs text-[var(--color-ink-3)] tabular-nums">
                                {formatTime(s.scheduledAt)}
                              </span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </section>
      </Container>
    </main>
  );
}

function ModeCard({
  href,
  title,
  body,
  tone,
  comingSoon,
}: {
  href: string;
  title: string;
  body: string;
  tone: 'rose' | 'sage' | 'mint';
  comingSoon?: boolean;
}) {
  const swatch =
    tone === 'rose'
      ? 'bg-[#fce8e6] text-[#9f3a4a]'
      : tone === 'sage'
        ? 'bg-[#e6efe7] text-[#385e44]'
        : 'bg-[#e6efe9] text-[#2d5f4d]';
  const inner = (
    <>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid h-9 w-9 place-items-center rounded-full ${swatch}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">{body}</p>
        </div>
      </div>
      {comingSoon && (
        <span className="absolute right-4 top-4 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warn)]">
          Sprint 1
        </span>
      )}
    </>
  );
  if (comingSoon) {
    return (
      <div
        aria-disabled="true"
        className="group relative cursor-not-allowed rounded-2xl border border-[var(--color-line)] bg-white p-5 opacity-90"
      >
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="group relative rounded-2xl border border-[var(--color-line)] bg-white p-5 transition-colors hover:border-[var(--color-ink-3)]"
    >
      {inner}
    </Link>
  );
}

function SearchStub() {
  return (
    <label className="hidden items-center gap-2 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm text-[var(--color-ink-3)] sm:flex">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        placeholder="Search by client name…"
        disabled
        className="w-40 bg-transparent outline-none"
      />
    </label>
  );
}

type SessionRow = Awaited<
  ReturnType<typeof prisma.session.findMany<{ include: { client: { select: { fullName: true } } } }>>
>[number];

interface DateGroup {
  label: string;
  rows: SessionRow[];
}

function groupByDate(rows: SessionRow[]): DateGroup[] {
  const groups = new Map<string, DateGroup>();
  for (const r of rows) {
    const key = r.scheduledAt.toISOString().slice(0, 10);
    const label = r.scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const existing = groups.get(key);
    if (existing) existing.rows.push(r);
    else groups.set(key, { label, rows: [r] });
  }
  return Array.from(groups.values());
}

function statusTone(status: SessionRow['status']): 'accent' | 'warn' | 'muted' | 'default' {
  switch (status) {
    case 'COMPLETED':
      return 'accent';
    case 'IN_PROGRESS':
      return 'warn';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'muted';
    default:
      return 'default';
  }
}

function statusLabel(status: SessionRow['status']): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
