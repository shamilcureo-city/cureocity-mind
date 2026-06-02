import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'notes', label: 'Notes' },
  { key: 'client', label: 'Client' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'session-info', label: 'Session Information' },
  { key: 'mindmap', label: 'Mindmap' },
  { key: 'reflection', label: 'Reflection Questions' },
] as const;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const { id } = await params;
  const session = await prisma.session.findUnique({
    where: { id },
    include: { client: { select: { fullName: true } } },
  });
  if (!session) notFound();

  return (
    <Container className="py-8">
      <Link
        href="/app"
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← All sessions
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">{session.client.fullName}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {session.modality} · {session.scheduledAt.toLocaleString('en-US')}
          </p>
        </div>
        <Badge tone={statusTone(session.status)}>{session.status.replace(/_/g, ' ').toLowerCase()}</Badge>
      </header>

      <nav className="mt-8 flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]" aria-label="Session sections">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            type="button"
            disabled
            className={`border-b-2 px-3 py-2.5 text-sm ${
              i === 0
                ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-3)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <Card className="mt-6 p-12 text-center">
        <p className="font-serif text-xl">Session workspace is in flight.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Notes, Transcript, Client, and Session Information ship in Sprint 3. Mindmap and
          Reflection Questions ship in Sprint 5.
        </p>
      </Card>
    </Container>
  );
}

function statusTone(status: string): 'accent' | 'warn' | 'muted' | 'default' {
  if (status === 'COMPLETED') return 'accent';
  if (status === 'IN_PROGRESS') return 'warn';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'muted';
  return 'default';
}
