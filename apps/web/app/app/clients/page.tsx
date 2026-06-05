import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const therapist = await prisma.psychologist.findUnique({
    where: { firebaseUid: 'dev-firebase-uid-priya' },
    select: { id: true },
  });
  const rows = therapist
    ? await prisma.client.findMany({
        where: { psychologistId: therapist.id, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: { sessions: { orderBy: { scheduledAt: 'desc' }, take: 1 } },
        take: 100,
      })
    : [];

  return (
    <Container className="py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Roster
          </p>
          <h1 className="mt-2 font-serif text-3xl">Clients</h1>
        </div>
        <button
          type="button"
          disabled
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white opacity-60"
        >
          + Create New
        </button>
      </header>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr] gap-3 border-b border-[var(--color-line-soft)] px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          <span>Name</span>
          <span>Client since</span>
          <span className="text-right tabular-nums">Total sessions</span>
          <span>Last session</span>
          <span className="text-right">Client type</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
            No clients yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/clients/${c.id}`}
                  className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr] gap-3 px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                >
                  <span className="font-medium text-[var(--color-ink)]">{c.fullName}</span>
                  <span className="text-[var(--color-ink-2)]">{formatMonth(c.createdAt)}</span>
                  <span className="text-right tabular-nums text-[var(--color-ink-2)]">
                    {c.sessions.length}
                  </span>
                  <span className="text-[var(--color-ink-2)]">
                    {c.sessions[0]
                      ? formatDateTime(c.sessions[0].scheduledAt)
                      : '—'}
                  </span>
                  <span className="text-right">
                    <Badge tone="muted">Individual</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </Container>
  );
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
