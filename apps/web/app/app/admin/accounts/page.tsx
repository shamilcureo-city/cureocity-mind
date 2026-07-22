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
} from '@/components/app/admin/AdminUI';
import { formatIstDate } from '@/lib/ist';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ q?: string; vertical?: string; status?: string }>;
}

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
  const { q, vertical, status } = await searchParams;
  const query = (q ?? '').trim();

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
    ];
  }

  const [accounts, billing, sessionCounts] = await Promise.all([
    prisma.psychologist.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        fullName: true,
        email: true,
        vertical: true,
        status: true,
        role: true,
        createdAt: true,
        onboardingCompletedAt: true,
      },
    }),
    prisma.billingAccount.findMany({ select: { psychologistId: true, plan: true } }),
    prisma.session.groupBy({ by: ['psychologistId'], _count: { _all: true } }),
  ]);

  const planByPsy = new Map<string, BillingPlan>(billing.map((b) => [b.psychologistId, b.plan]));
  const sessionsByPsy = new Map(sessionCounts.map((s) => [s.psychologistId, s._count._all]));

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Accounts"
        description="Every practitioner on the platform. Open a row to verify, change role or status, or adjust the trial runway."
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" method="GET">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-[var(--color-ink-3)]">Search</label>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Name, email, phone, RCI…"
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
        {(query || vertical || status) && (
          <Link
            href="/app/admin/accounts"
            className="h-[38px] rounded-full border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            Clear
          </Link>
        )}
      </form>

      <AdminCard
        hint={`${accounts.length} account${accounts.length === 1 ? '' : 's'}${accounts.length === 100 ? ' (showing first 100)' : ''}`}
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
                      <Link
                        href={`/app/admin/accounts/${a.id}`}
                        className="font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                      >
                        {a.fullName || '(no name)'}
                      </Link>
                      <div className="text-xs text-[var(--color-ink-3)]">{a.email}</div>
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
      </AdminCard>
    </>
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
