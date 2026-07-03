import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientsHeader } from '@/components/app/ClientsHeader';
import { ClientSearchControls } from '@/components/app/ClientSearchControls';
import { HelpNote } from '@/components/app/EduHeading';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const STATUSES = ['ACTIVE', 'PAUSED', 'DISCHARGED', 'TRANSFERRED'] as const;
type ClientStatus = (typeof STATUSES)[number];

function parseStatus(raw: string | undefined): ClientStatus | undefined {
  return STATUSES.find((s) => s === raw);
}

interface SearchParams {
  q?: string;
  status?: string;
  cursor?: string;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const therapist = await requireOnboardedPsychologist();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const status = parseStatus(sp.status);
  const cursor = sp.cursor;

  const where: Prisma.ClientWhereInput = {
    psychologistId: therapist.id,
    deletedAt: null,
    ...(status && { status }),
    ...(q && { fullName: { contains: q, mode: 'insensitive' } }),
  };

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        fullName: true,
        fullNameEncrypted: true,
        status: true,
        isDemo: true,
        createdAt: true,
        _count: { select: { sessions: true } },
        sessions: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
          select: { scheduledAt: true },
        },
      },
    }),
    prisma.client.count({ where }),
  ]);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null;
  // PII read cutover — decrypt each client's name (plaintext fallback). The
  // search filter above still matches on the dual-written plaintext column.
  const names = await Promise.all(
    pageRows.map((c) => decryptClientField(therapist.id, c.fullNameEncrypted, c.fullName)),
  );

  // Preserve the active query + status when paginating.
  const nextHref = nextCursor
    ? `/app/clients?${new URLSearchParams({
        ...(q && { q }),
        ...(status && { status }),
        cursor: nextCursor,
      }).toString()}`
    : null;

  const filtered = Boolean(q || status);

  return (
    <Container className="py-10">
      <ClientsHeader />

      <ClientSearchControls />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-2.5 text-xs text-[var(--color-ink-3)]">
          <span>
            {total} client{total === 1 ? '' : 's'}
            {filtered ? ' match' : ''}
            {cursor ? ' · more pages' : ''}
          </span>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-[var(--color-line-soft)] px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          <span>Name</span>
          <span>Status</span>
          <span>Client since</span>
          <span className="text-right tabular-nums">Total sessions</span>
          <span>Last session</span>
        </div>
        {pageRows.length === 0 ? (
          filtered ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
              No clients match your search.
            </p>
          ) : (
            <div className="px-5 py-8">
              <HelpNote title="No clients yet — this is where you start">
                Add your first client (just a name and phone), then you can record a session.{' '}
                <Link
                  href="/app/learn/add-a-client"
                  className="text-[var(--color-accent)] underline"
                >
                  How adding a client works →
                </Link>
              </HelpNote>
            </div>
          )
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {pageRows.map((c, i) => (
              <li key={c.id}>
                <Link
                  href={`/app/clients/${c.id}`}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 px-5 py-4 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-ink)]">
                    {names[i]}
                    {c.isDemo && <Badge tone="warn">Example</Badge>}
                  </span>
                  <span>
                    <Badge tone={c.status === 'ACTIVE' ? 'accent' : 'muted'}>
                      {c.status.toLowerCase()}
                    </Badge>
                  </span>
                  <span className="text-[var(--color-ink-2)]">{formatMonth(c.createdAt)}</span>
                  <span className="text-right tabular-nums text-[var(--color-ink-2)]">
                    {c._count.sessions}
                  </span>
                  <span className="text-[var(--color-ink-2)]">
                    {c.sessions[0] ? formatDateTime(c.sessions[0].scheduledAt) : '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {nextHref && (
        <div className="mt-4 flex justify-center">
          <Link
            href={nextHref}
            className="rounded-full border border-[var(--color-line)] bg-white px-5 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            Load next {PAGE_SIZE} →
          </Link>
        </div>
      )}
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
