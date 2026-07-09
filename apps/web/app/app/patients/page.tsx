import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ClientsHeader } from '@/components/app/ClientsHeader';
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

interface SearchParams {
  cursor?: string;
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const doctor = await requireOnboardedDoctor();
  const sp = await searchParams;
  const cursor = sp.cursor;

  const where: Prisma.ClientWhereInput = {
    psychologistId: doctor.id,
    deletedAt: null,
  };

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

  return (
    <Container className="py-10">
      <ClientsHeader vertical="DOCTOR" />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-2.5 text-xs text-[var(--color-ink-3)]">
          <span>
            {total} patient{total === 1 ? '' : 's'}
            {cursor ? ' · more pages' : ''}
          </span>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 border-b border-[var(--color-line-soft)] px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          <span>Name</span>
          <span>Status</span>
          <span>Patient since</span>
          <span className="text-right tabular-nums">Encounters</span>
          <span>Last encounter</span>
        </div>
        {pageRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-3)]">
            No patients yet — add your first with “+ New patient”.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {pageRows.map((c, i) => (
              <li key={c.id}>
                <Link
                  href={`/app/patients/${c.id}`}
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
