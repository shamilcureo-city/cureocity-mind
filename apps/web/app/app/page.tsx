import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RecordingShell } from '@/components/app/RecordingShell';
import { prisma } from '@/lib/prisma';
import type { Session as SessionPrismaRow } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function RecordPage() {
  const therapist = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    select: { id: true, fullName: true },
  });

  const [sessions, clients] = therapist
    ? await Promise.all([
        prisma.session.findMany({
          where: { psychologistId: therapist.id },
          orderBy: { scheduledAt: 'desc' },
          take: 30,
          include: { client: { select: { fullName: true } } },
        }),
        prisma.client.findMany({
          where: { psychologistId: therapist.id, deletedAt: null, status: 'ACTIVE' },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true, preferredModality: true },
        }),
      ])
    : [[], []];

  const grouped = groupByDate(sessions as SessionWithClient[]);

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

        <RecordingShell initialClients={clients} />

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-xl">Recent sessions</h2>
            <p className="text-xs text-[var(--color-ink-3)]">
              Showing the last {sessions.length} session{sessions.length === 1 ? '' : 's'}
            </p>
          </div>

          {grouped.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="font-serif text-xl">No sessions yet.</p>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                Pick a capture mode above to start your first recording.
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

type SessionWithClient = SessionPrismaRow & { client: { fullName: string } };

interface DateGroup {
  label: string;
  rows: SessionWithClient[];
}

function groupByDate(rows: SessionWithClient[]): DateGroup[] {
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

function statusTone(status: SessionWithClient['status']): 'accent' | 'warn' | 'muted' | 'default' {
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

function statusLabel(status: SessionWithClient['status']): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
