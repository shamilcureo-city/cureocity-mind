import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FirstRunChecklist } from '@/components/app/FirstRunChecklist';
import { RecordingShell } from '@/components/app/RecordingShell';
import type { ClientTileEntry } from '@/components/app/ClientPicker';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';
import type { Session as SessionPrismaRow } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function RecordPage() {
  const therapist = await requireOnboardedPsychologist();

  // Sprint DV2 — doctors don't use the therapy record surface; their home
  // is the patient roster. See docs/DOCTOR_VERTICAL.md.
  if (therapist.vertical === 'DOCTOR') redirect('/app/patients');

  const [sessions, rawClients] = therapist
    ? await Promise.all([
        prisma.session.findMany({
          where: { psychologistId: therapist.id },
          orderBy: { scheduledAt: 'desc' },
          take: 30,
          include: { client: { select: { fullName: true } } },
        }),
        // Sprint 23 — Client tiles need the most recent COMPLETED
        // session's `endedAt` to render "last 2d ago" copy. Inline
        // include (take: 1) keeps the query a single round-trip.
        prisma.client.findMany({
          where: { psychologistId: therapist.id, deletedAt: null, status: 'ACTIVE' },
          orderBy: { fullName: 'asc' },
          select: {
            id: true,
            fullName: true,
            preferredModality: true,
            isDemo: true,
            sessions: {
              where: { status: 'COMPLETED' },
              orderBy: { endedAt: 'desc' },
              take: 1,
              select: { endedAt: true },
            },
          },
        }),
      ])
    : [[], []];

  const clients: ClientTileEntry[] = rawClients.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    preferredModality: c.preferredModality,
    lastCompletedSessionAt: c.sessions[0]?.endedAt?.toISOString() ?? null,
    isDemo: c.isDemo,
  }));

  const grouped = groupByDate(sessions as SessionWithClient[]);

  return (
    <main>
      <Container className="py-10">
        <RecordingShell clients={clients} />

        <FirstRunChecklist psychologistId={therapist.id} />

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
    const label = r.scheduledAt.toLocaleDateString('en-IN', {
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
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
