import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { planTierLabel, type BillingPlan } from '@cureocity/contracts';
import {
  AdminPageHeader,
  AdminCard,
  Table,
  Thead,
  Tr,
  Td,
  EmptyRow,
  Pill,
  type PillTone,
} from '@/components/console/AdminUI';
import { formatIstDate } from '@/lib/ist';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    vertical?: string;
    status?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

const STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: 'good',
  PENDING_VERIFICATION: 'warn',
  SUSPENDED: 'danger',
  OFFBOARDED: 'muted',
};

/**
 * PC2 — the practitioner directory. Search by name / email / phone, filter
 * by vertical and status. Each row links to the account detail where role,
 * status, verification and trial cap are managed. Practitioner identity
 * (name/email) is the account holder's own — not client PII.
 */
export default async function AdminAccountsPage({ searchParams }: PageProps) {
  await requirePageAdmin();
  const { q, vertical, status, page: rawPage } = await searchParams;
  const query = (q ?? '').trim();
  const parsedPage = Number.parseInt(rawPage ?? '1', 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const where: Prisma.PsychologistWhereInput = { deletedAt: null };
  if (vertical === 'THERAPIST' || vertical === 'DOCTOR') where.vertical = vertical;
  if (status && ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'OFFBOARDED'].includes(status)) {
    where.status = status as Prisma.PsychologistWhereInput['status'];
  }
  if (query) {
    where.OR = [
      { fullName: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query } },
      { rciNumber: { contains: query, mode: 'insensitive' } },
      { medicalRegNumber: { contains: query, mode: 'insensitive' } },
    ];
  }

  const totalAccounts = await prisma.psychologist.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalAccounts / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const accounts = await prisma.psychologist.findMany({
    where,
    orderBy: [{ isSynthetic: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      fullName: true,
      email: true,
      vertical: true,
      status: true,
      role: true,
      isSynthetic: true,
      rciNumber: true,
      medicalRegNumber: true,
      createdAt: true,
      onboardingCompletedAt: true,
    },
  });
  const accountIds = accounts.map((account) => account.id);
  const [billing, sessionCounts] = await Promise.all([
    prisma.billingAccount.findMany({
      where: { psychologistId: { in: accountIds } },
      select: { psychologistId: true, plan: true },
    }),
    prisma.session.groupBy({
      by: ['psychologistId'],
      where: { psychologistId: { in: accountIds } },
      _count: { _all: true },
    }),
  ]);

  const planByPsy = new Map<string, BillingPlan>(billing.map((b) => [b.psychologistId, b.plan]));
  const sessionsByPsy = new Map(sessionCounts.map((s) => [s.psychologistId, s._count._all]));

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Accounts"
        description="All platform accounts. Fictional profiles are marked Demo and use non-issued registration numbers."
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" method="GET">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-[var(--color-ink-3)]">Search</label>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Name, email, phone, RCI or medical registration…"
            className="w-full rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <Select
          name="vertical"
          label="Vertical"
          value={vertical}
          options={['THERAPIST', 'DOCTOR']}
        />
        <Select
          name="status"
          label="Status"
          value={status}
          options={['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'OFFBOARDED']}
        />
        <button
          type="submit"
          className="h-[38px] rounded-full bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:opacity-90"
        >
          Filter
        </button>
        {(query || vertical || status || currentPage > 1) && (
          <Link
            href="/console/accounts"
            className="h-[38px] rounded-full border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            Clear
          </Link>
        )}
      </form>

      <AdminCard
        hint={`${totalAccounts} account${totalAccounts === 1 ? '' : 's'} · page ${currentPage} of ${totalPages}`}
      >
        <Table>
          <Thead
            cols={[
              { label: 'Practitioner' },
              { label: 'Vertical' },
              { label: 'Status' },
              { label: 'Role' },
              { label: 'Plan' },
              { label: 'Sessions', align: 'right' },
              { label: 'Joined', align: 'right' },
            ]}
          />
          <tbody>
            {accounts.length === 0 ? (
              <EmptyRow colSpan={7}>No accounts match those filters.</EmptyRow>
            ) : (
              accounts.map((a) => {
                const plan = planByPsy.get(a.id);
                return (
                  <Tr key={a.id}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/console/accounts/${a.id}`}
                          className="font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                        >
                          {a.fullName || '(no name)'}
                        </Link>
                        {a.isSynthetic && <Pill tone="muted">Demo</Pill>}
                      </div>
                      <div className="text-xs text-[var(--color-ink-3)]">{a.email}</div>
                      {(a.medicalRegNumber || a.rciNumber) && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                          {a.vertical === 'DOCTOR' ? 'Medical reg.' : 'RCI'} ·{' '}
                          {a.vertical === 'DOCTOR' ? a.medicalRegNumber : a.rciNumber}
                        </div>
                      )}
                      {a.onboardingCompletedAt === null && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-warn)]">
                          not onboarded
                        </div>
                      )}
                    </Td>
                    <Td muted>{a.vertical === 'DOCTOR' ? 'Doctor' : 'Therapist'}</Td>
                    <Td>
                      <Pill tone={STATUS_TONE[a.status] ?? 'muted'}>
                        {a.status.replace(/_/g, ' ').toLowerCase()}
                      </Pill>
                    </Td>
                    <Td>
                      {a.role === 'ADMIN' ? (
                        <Pill tone="accent">admin</Pill>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">—</span>
                      )}
                    </Td>
                    <Td muted>{plan ? planTierLabel(plan) : '—'}</Td>
                    <Td align="right" nums>
                      {sessionsByPsy.get(a.id) ?? 0}
                    </Td>
                    <Td align="right" muted>
                      {formatIstDate(a.createdAt)}
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalAccounts={totalAccounts}
          query={query}
          vertical={vertical}
          status={status}
        />
      </AdminCard>
    </>
  );
}

function Pagination({
  currentPage,
  totalPages,
  totalAccounts,
  query,
  vertical,
  status,
}: {
  currentPage: number;
  totalPages: number;
  totalAccounts: number;
  query: string;
  vertical: string | undefined;
  status: string | undefined;
}) {
  if (totalAccounts === 0) return null;
  const first = (currentPage - 1) * PAGE_SIZE + 1;
  const last = Math.min(currentPage * PAGE_SIZE, totalAccounts);
  const href = (page: number) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (vertical) params.set('vertical', vertical);
    if (status) params.set('status', status);
    if (page > 1) params.set('page', String(page));
    return `/console/accounts?${params.toString()}`;
  };
  const buttonClass =
    'rounded-full border border-[var(--color-line)] bg-white px-3.5 py-1.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]';
  const disabledClass =
    'rounded-full border border-[var(--color-line-soft)] px-3.5 py-1.5 text-sm text-[var(--color-ink-3)] opacity-50';

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] pt-4">
      <p className="text-xs text-[var(--color-ink-3)]">
        Showing {first}–{last} of {totalAccounts}
      </p>
      <div className="flex items-center gap-2">
        {currentPage > 1 ? (
          <Link href={href(currentPage - 1)} className={buttonClass}>
            Previous
          </Link>
        ) : (
          <span className={disabledClass}>Previous</span>
        )}
        <span className="px-1 text-xs tabular-nums text-[var(--color-ink-3)]">
          {currentPage} / {totalPages}
        </span>
        {currentPage < totalPages ? (
          <Link href={href(currentPage + 1)} className={buttonClass}>
            Next
          </Link>
        ) : (
          <span className={disabledClass}>Next</span>
        )}
      </div>
    </div>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: string[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--color-ink-3)]">{label}</label>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="h-[38px] rounded-full border border-[var(--color-line)] bg-white px-3 text-sm outline-none focus:border-[var(--color-accent)]"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ').toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
