import Link from 'next/link';
import { notFound } from 'next/navigation';
import { planTierLabel, isPaidPlan } from '@cureocity/contracts';
import {
  AdminPageHeader,
  AdminCard,
  Pill,
  DefRow,
  StatGrid,
  StatTile,
  inr,
  type PillTone,
} from '@/components/console/AdminUI';
import { AccountActions } from '@/components/console/AccountActions';
import { requirePageAdmin } from '@/lib/auth-page';
import { getEntitlement } from '@/lib/billing';
import { formatIstDate, formatIstDateTime } from '@/lib/ist';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: 'good',
  PENDING_VERIFICATION: 'warn',
  SUSPENDED: 'danger',
  OFFBOARDED: 'muted',
};

/**
 * PC2 — practitioner account detail. Profile + registration + usage +
 * billing, and the admin action panel (role / status / trial cap). The
 * console layout already guarded ADMIN; we resolve the acting admin here
 * only to disable self-actions in the UI (the routes refuse them too).
 */
export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePageAdmin();
  const { id } = await params;

  const account = await prisma.psychologist.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      vertical: true,
      status: true,
      role: true,
      rciNumber: true,
      rciVerifiedAt: true,
      medicalRegNumber: true,
      specialty: true,
      defaultModality: true,
      onboardingCompletedAt: true,
      createdAt: true,
    },
  });
  if (!account) notFound();

  const [clientCount, sessionCount, signedCount, aiCost, entitlement] = await Promise.all([
    prisma.client.count({ where: { psychologistId: id, deletedAt: null } }),
    prisma.session.count({ where: { psychologistId: id } }),
    prisma.therapyNote.count({ where: { session: { psychologistId: id } } }),
    prisma.geminiCallLog.aggregate({
      where: { psychologistId: id },
      _sum: { costInr: true },
    }),
    getEntitlement(id),
  ]);

  const lifetimeCostInr = Number(aiCost._sum.costInr ?? 0);
  const isSelf = id === admin.id;

  return (
    <>
      <Link
        href="/console/accounts"
        className="text-sm text-[var(--color-accent)] hover:underline"
      >
        ← All accounts
      </Link>
      <AdminPageHeader
        eyebrow={account.vertical === 'DOCTOR' ? 'Doctor account' : 'Therapist account'}
        title={account.fullName || '(no name)'}
        description={account.email}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONE[account.status] ?? 'muted'}>
              {account.status.replace(/_/g, ' ').toLowerCase()}
            </Pill>
            {account.role === 'ADMIN' && <Pill tone="accent">admin</Pill>}
          </div>
        }
      />

      <StatGrid>
        <StatTile label="Clients" value={String(clientCount)} />
        <StatTile label="Sessions" value={String(sessionCount)} sub={`${signedCount} signed`} />
        <StatTile
          label="Plan"
          value={planTierLabel(entitlement.plan)}
          sub={
            isPaidPlan(entitlement.plan)
              ? 'paid'
              : `trial ${entitlement.trialUsed}/${entitlement.trialCap}`
          }
          tone={isPaidPlan(entitlement.plan) ? 'good' : 'default'}
        />
        <StatTile label="AI cost · lifetime" value={inr(lifetimeCostInr)} />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Registration & profile">
          <div className="space-y-0">
            <DefRow label="Full name">{account.fullName || '—'}</DefRow>
            <DefRow label="Email">{account.email}</DefRow>
            <DefRow label="Phone">{account.phone}</DefRow>
            <DefRow label="Vertical">
              {account.vertical === 'DOCTOR' ? 'Doctor' : 'Therapist'}
            </DefRow>
            {account.vertical === 'DOCTOR' ? (
              <>
                <DefRow label="Medical reg. no.">{account.medicalRegNumber ?? '—'}</DefRow>
                <DefRow label="Specialty">{account.specialty ?? '—'}</DefRow>
              </>
            ) : (
              <DefRow label="RCI number">
                {account.rciNumber}
                {account.rciVerifiedAt ? (
                  <span className="ml-2">
                    <Pill tone="good">verified</Pill>
                  </span>
                ) : (
                  <span className="ml-2">
                    <Pill tone="warn">unverified</Pill>
                  </span>
                )}
              </DefRow>
            )}
            <DefRow label="Default modality">{account.defaultModality ?? '—'}</DefRow>
            <DefRow label="Onboarded">
              {account.onboardingCompletedAt
                ? formatIstDate(account.onboardingCompletedAt)
                : 'not yet'}
            </DefRow>
            <DefRow label="Joined">{formatIstDateTime(account.createdAt)}</DefRow>
          </div>
        </AdminCard>

        <AdminCard title="Admin actions">
          <AccountActions
            accountId={account.id}
            role={account.role}
            status={account.status}
            trialCap={entitlement.trialCap}
            isSelf={isSelf}
          />
        </AdminCard>
      </div>

      <p className="mt-4 text-xs text-[var(--color-ink-3)]">
        Client records and session content are never shown here — the console sees account state and
        counts, not a practitioner&rsquo;s clinical data. Use{' '}
        <Link href="/console/comp" className="text-[var(--color-accent)] hover:underline">
          Comp
        </Link>{' '}
        to grant a paid tier, or{' '}
        <Link href="/console/audit" className="text-[var(--color-accent)] hover:underline">
          Audit
        </Link>{' '}
        to see this account&rsquo;s activity.
      </p>
    </>
  );
}
