import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientsHeader } from '@/components/app/ClientsHeader';
import { ArchivePatientButton } from '@/components/app/ArchivePatientButton';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV2 — the doctor's patient roster. The data layer is the same
 * Client model the therapist uses; this page is doctor-guarded + labelled
 * "Patients" and links into the doctor patient detail. Kept isolated from
 * the therapy clients pages (which carry journey/diagnosis surfaces) so
 * there's zero therapist-flow regression. See docs/DOCTOR_VERTICAL.md.
 */
const PAGE_SIZE = 50;
/**
 * Batch F — how many patients a search may scan.
 *
 * Names and phone numbers are envelope-encrypted, so there is no `contains`
 * query to run: the only way to search them is to decrypt and filter. The
 * per-tenant DEK is unwrapped once and cached in-process, so this is local
 * AES over N rows rather than N key-management calls — cheap at pilot scale,
 * but bounded, and the UI says so when the bound is hit rather than quietly
 * returning a partial answer.
 */
const SEARCH_SCAN_LIMIT = 2_000;

interface SearchParams {
  cursor?: string;
  q?: string;
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const doctor = await requireOnboardedDoctor();
  const sp = await searchParams;
  const query = sp.q?.trim() ?? '';
  // A search resets pagination — a cursor from the unfiltered list is
  // meaningless against a filtered one.
  const cursor = query ? undefined : sp.cursor;

  const where: Prisma.ClientWhereInput = {
    psychologistId: doctor.id,
    deletedAt: null,
  };

  if (query) {
    const result = await searchPatients(doctor.id, where, query);
    return renderRoster({
      doctorId: doctor.id,
      rows: result.rows,
      names: result.names,
      total: result.total,
      query,
      cursor: undefined,
      nextHref: null,
      truncated: result.truncated,
    });
  }

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
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
  const nextHref = nextCursor ? `/app/patients?cursor=${nextCursor}` : null;
  // PII read cutover — decrypt each patient's name (plaintext fallback).
  const names = await Promise.all(
    pageRows.map((c) => decryptClientField(doctor.id, c.fullNameEncrypted)),
  );

  return renderRoster({
    doctorId: doctor.id,
    rows: pageRows,
    names,
    total,
    query: '',
    cursor,
    nextHref,
    truncated: false,
  });
}

/** The row shape both the paginated and searched paths produce. */
type RosterRow = {
  id: string;
  status: string;
  isDemo: boolean;
  createdAt: Date;
  _count: { sessions: number };
  sessions: { scheduledAt: Date }[];
};

/**
 * Batch F — patient SEARCH.
 *
 * A doctor's roster grew past the point where a 50-per-page reverse-chronological
 * list is usable: finding a returning patient meant paging until you saw the
 * name. There was no search at all, because names and phones are envelope-
 * encrypted and there is nothing to run a `contains` against.
 *
 * So: scan a bounded window of the tenant's patients, decrypt with the cached
 * per-tenant DEK (local AES, one unwrap), and match on name or phone. Bounded
 * and honest — `truncated` tells the doctor when the scan hit its ceiling
 * instead of implying the roster holds nothing more.
 */
async function searchPatients(
  doctorId: string,
  where: Prisma.ClientWhereInput,
  query: string,
): Promise<{ rows: RosterRow[]; names: string[]; total: number; truncated: boolean }> {
  const candidates = await prisma.client.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: SEARCH_SCAN_LIMIT + 1,
    select: {
      id: true,
      fullNameEncrypted: true,
      contactPhoneEncrypted: true,
      status: true,
      isDemo: true,
      createdAt: true,
      _count: { select: { sessions: true } },
      sessions: { orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
    },
  });
  const truncated = candidates.length > SEARCH_SCAN_LIMIT;
  const scanned = truncated ? candidates.slice(0, SEARCH_SCAN_LIMIT) : candidates;

  const needle = query.toLowerCase();
  // Digits-only comparison so "98765 43210", "+919876543210" and "9876543210"
  // all find the same patient.
  const needleDigits = query.replace(/\D/g, '');

  const rows: RosterRow[] = [];
  const names: string[] = [];
  for (const c of scanned) {
    const name = await decryptClientField(doctorId, c.fullNameEncrypted);
    let hit = name.toLowerCase().includes(needle);
    if (!hit && needleDigits.length >= 4) {
      const phone = await decryptClientField(doctorId, c.contactPhoneEncrypted);
      hit = phone.replace(/\D/g, '').includes(needleDigits);
    }
    if (!hit) continue;
    rows.push(c);
    names.push(name);
    if (rows.length >= PAGE_SIZE) break;
  }
  return { rows, names, total: rows.length, truncated };
}

function renderRoster({
  rows,
  names,
  total,
  query,
  cursor,
  nextHref,
  truncated,
}: {
  doctorId: string;
  rows: RosterRow[];
  names: string[];
  total: number;
  query: string;
  cursor: string | undefined;
  nextHref: string | null;
  truncated: boolean;
}) {
  return (
    <Container className="py-10">
      <ClientsHeader vertical="DOCTOR" />

      {/* Batch F — find a returning patient without paging the whole roster.
          A plain GET form, so it works before hydration and the result is a
          shareable/bookmarkable URL. */}
      <form method="GET" action="/app/patients" className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or phone…"
          aria-label="Search patients by name or phone"
          className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none sm:max-w-sm"
        />
        <button
          type="submit"
          className="rounded-full border border-[var(--color-line)] bg-white px-5 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          Search
        </button>
        {query && (
          <Link
            href="/app/patients"
            className="self-center text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            Clear
          </Link>
        )}
      </form>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-2.5 text-xs text-[var(--color-ink-3)]">
          <span>
            {query ? (
              <>
                {total} match{total === 1 ? '' : 'es'} for “{query}”
                {total >= PAGE_SIZE ? ` (showing the first ${PAGE_SIZE})` : ''}
              </>
            ) : (
              <>
                {total} patient{total === 1 ? '' : 's'}
                {cursor ? ' · more pages' : ''}
              </>
            )}
          </span>
        </div>
        {truncated && (
          <p className="border-b border-[var(--color-line-soft)] bg-[var(--color-warn-soft)] px-5 py-2.5 text-xs text-[var(--color-warn)]">
            Only the {SEARCH_SCAN_LIMIT.toLocaleString('en-IN')} most recent patients were searched.
            If the patient you want is older than that, narrow the search or open them from their
            encounter.
          </p>
        )}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-[var(--color-line-soft)] px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          <span>Name</span>
          <span>Status</span>
          <span>Patient since</span>
          <span className="text-right tabular-nums">Encounters</span>
          <span>Last encounter</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
            {query
              ? `No patient matches “${query}”.`
              : 'No patients yet — add your first with “+ New patient”.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {rows.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center transition-colors hover:bg-[var(--color-surface-soft)]"
              >
                <Link
                  href={`/app/patients/${c.id}`}
                  className="grid min-w-0 flex-1 grid-cols-[2fr_1fr_1fr_1fr_1.5fr] items-center gap-3 px-5 py-4 text-sm"
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
                <div className="shrink-0 pr-4">
                  <ArchivePatientButton
                    clientId={c.id}
                    noun="patient"
                    name={names[i]}
                    variant="row"
                  />
                </div>
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
