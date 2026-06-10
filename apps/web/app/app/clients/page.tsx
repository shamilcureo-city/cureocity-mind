import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientsHeader } from '@/components/app/ClientsHeader';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const therapist = await requireOnboardedPsychologist();
  const rows = await prisma.client.findMany({
    where: { psychologistId: therapist.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { sessions: { orderBy: { scheduledAt: 'desc' }, take: 1 } },
    take: 100,
  });

  return (
    <Container className="py-10">
      <ClientsHeader />

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
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
