import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { MindClientRosterRows } from '@/components/app/MindClientRosterRows';
import { ClientsHeader } from '@/components/app/ClientsHeader';
import { ArchivePatientButton } from '@/components/app/ArchivePatientButton';
import { ClientSearchControls } from '@/components/app/ClientSearchControls';
import { HelpNote } from '@/components/app/EduHeading';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { formatIstDateTime } from '@/lib/ist';
import { prisma } from '@/lib/prisma';
import { clientCreationEntry } from '@/lib/client-entry-intent';

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
  new?: string;
  returnTo?: string;
  capture?: string;
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
  };

  const clientSelect = {
    id: true,
    fullNameEncrypted: true,
    status: true,
    isDemo: true,
    createdAt: true,
    _count: { select: { sessions: true } },
  } satisfies Prisma.ClientSelect;

  let pageRows: Prisma.ClientGetPayload<{ select: typeof clientSelect }>[];
  let names: string[];
  let nextCursor: string | null;
  let total: number;

  if (q) {
    // The client name is now envelope-encrypted, so a substring search can no
    // longer run in SQL. Load the tenant roster, decrypt every name, then
    // filter + cursor-paginate in memory (a solo therapist's roster is small).
    const all = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: clientSelect,
    });
    const allNames = await Promise.all(
      all.map((c) => decryptClientField(therapist.id, c.fullNameEncrypted)),
    );
    const needle = q.toLowerCase();
    const matched = all
      .map((row, i) => ({ row, name: allNames[i] ?? '' }))
      .filter((m) => m.name.toLowerCase().includes(needle));
    total = matched.length;
    let start = 0;
    if (cursor) {
      const at = matched.findIndex((m) => m.row.id === cursor);
      start = at >= 0 ? at + 1 : 0;
    }
    const pageSlice = matched.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < matched.length;
    pageRows = pageSlice.map((m) => m.row);
    names = pageSlice.map((m) => m.name);
    nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null;
  } else {
    const [rows, count] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: clientSelect,
      }),
      prisma.client.count({ where }),
    ]);
    const hasMore = rows.length > PAGE_SIZE;
    pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null;
    total = count;
    // PII read cutover — decrypt each client's name from the encrypted column.
    names = await Promise.all(
      pageRows.map((c) => decryptClientField(therapist.id, c.fullNameEncrypted)),
    );
  }

  const pageClientIds = pageRows.map((client) => client.id);
  const [completed, upcoming] = pageClientIds.length
    ? await Promise.all([
        prisma.session.groupBy({
          by: ['clientId'],
          where: {
            psychologistId: therapist.id,
            clientId: { in: pageClientIds },
            status: 'COMPLETED',
          },
          _max: { endedAt: true, scheduledAt: true },
        }),
        prisma.session.groupBy({
          by: ['clientId'],
          where: {
            psychologistId: therapist.id,
            clientId: { in: pageClientIds },
            status: 'SCHEDULED',
            scheduledAt: { gte: new Date() },
          },
          _min: { scheduledAt: true },
        }),
      ])
    : [[], []];
  const lastByClient = new Map(
    completed.map((row) => [row.clientId, row._max.endedAt ?? row._max.scheduledAt]),
  );
  const nextByClient = new Map(upcoming.map((row) => [row.clientId, row._min.scheduledAt]));

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
      <ClientsHeader key={`${sp.new ?? ''}:${sp.returnTo ?? ''}`} {...clientCreationEntry(sp)} />

      <ClientSearchControls />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-2.5 text-xs text-[var(--color-ink-3)]">
          <span>
            {total} client{total === 1 ? '' : 's'}
            {filtered ? ' match' : ''}
            {cursor ? ' · more pages' : ''}
          </span>
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
          <MindClientRosterRows
            rows={pageRows.map((c, i) => ({
              id: c.id,
              name: names[i] ?? '',
              status: c.status,
              isDemo: c.isDemo,
              clientSinceLabel: formatMonth(c.createdAt),
              totalRecords: c._count.sessions,
              lastCompletedLabel: lastByClient.get(c.id)
                ? formatDateTime(lastByClient.get(c.id)!)
                : 'None yet',
              nextAppointmentLabel: nextByClient.get(c.id)
                ? formatDateTime(nextByClient.get(c.id)!)
                : 'Not booked',
              action: (
                <ArchivePatientButton clientId={c.id} noun="client" name={names[i]} variant="row" />
              ),
            }))}
          />
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
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatDateTime(d: Date): string {
  // UI truth pass — same clock as the session pages (IST), not server-UTC.
  return formatIstDateTime(d);
}
