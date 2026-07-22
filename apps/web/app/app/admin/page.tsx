import Link from 'next/link';
import { isPaidPlan, PLAN_CATALOG, intervalMonths, type BillingPlan } from '@cureocity/contracts';
import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  Table,
  Thead,
  Tr,
  Td,
  EmptyRow,
  inr,
} from '@/components/app/admin/AdminUI';
import { planAmountInr } from '@/lib/billing';
import { formatIstDateTime } from '@/lib/ist';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_GRACE_MS = 3 * DAY_MS;

/**
 * PC2 — the super-admin console landing. One glance at the platform pulse:
 * who's on it, what it earns, what it costs to run, and what needs
 * attention (compliance, waitlist, trials). Everything deterministic over
 * existing tables — no new storage.
 */
export default async function AdminOverviewPage() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const graceFloor = new Date(now.getTime() - PAID_GRACE_MS);

  const [
    therapistCount,
    doctorCount,
    pendingVerification,
    suspended,
    sessionsWeek,
    costToday,
    costMonth,
    accounts,
    openErasures,
    openGrievances,
    waitlistWaiting,
    recentAdminActions,
  ] = await Promise.all([
    prisma.psychologist.count({ where: { deletedAt: null, vertical: 'THERAPIST' } }),
    prisma.psychologist.count({ where: { deletedAt: null, vertical: 'DOCTOR' } }),
    prisma.psychologist.count({ where: { deletedAt: null, status: 'PENDING_VERIFICATION' } }),
    prisma.psychologist.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    prisma.session.count({
      where: { createdAt: { gte: weekAgo }, client: { isDemo: false } },
    }),
    prisma.geminiCallLog.aggregate({
      where: { createdAt: { gte: dayStart } },
      _sum: { costInr: true },
    }),
    prisma.geminiCallLog.aggregate({
      where: { createdAt: { gte: monthAgo } },
      _sum: { costInr: true },
    }),
    prisma.billingAccount.findMany({
      select: { psychologistId: true, plan: true, paidThroughAt: true },
    }),
    prisma.clientErasureRequest.count({ where: { status: 'PENDING' } }),
    prisma.clientGrievance.count({ where: { status: 'OPEN' } }),
    prisma.careWaitlistEntry.count({ where: { invitedAt: null } }),
    prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'ADMIN_ROLE_GRANTED',
            'ADMIN_ROLE_REVOKED',
            'ADMIN_ACCOUNT_STATUS_CHANGED',
            'ADMIN_TRIAL_CAP_ADJUSTED',
            'PLAN_UPGRADED',
            'CARE_WAITLIST_INVITED',
            'CARE_WAITLIST_REMOVED',
            'ENCRYPTION_BACKFILL_RAN',
            'PILOT_INVITE_CREATED',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, action: true, createdAt: true, targetType: true, metadata: true },
    }),
  ]);

  // MRR from active-paid accounts (mirror funnel logic).
  const monthlyInr = (plan: BillingPlan) =>
    Math.round(planAmountInr(plan) / intervalMonths(PLAN_CATALOG[plan].interval));
  let mrr = 0;
  let paying = 0;
  for (const a of accounts) {
    if (isPaidPlan(a.plan) && a.paidThroughAt !== null && a.paidThroughAt > graceFloor) {
      mrr += monthlyInr(a.plan);
      paying += 1;
    }
  }

  const costTodayInr = Number(costToday._sum.costInr ?? 0);
  const costMonthInr = Number(costMonth._sum.costInr ?? 0);
  const attentionCount = openErasures + openGrievances + pendingVerification;

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Overview"
        description="The platform at a glance — accounts, revenue, running cost, and what needs a human. All read live from the record."
      />

      <StatGrid>
        <StatTile
          label="Practitioners"
          value={String(therapistCount + doctorCount)}
          sub={`${therapistCount} therapist · ${doctorCount} doctor`}
          href="/app/admin/accounts"
        />
        <StatTile
          label="MRR"
          value={inr(mrr)}
          sub={`${paying} paying`}
          tone="accent"
          href="/app/admin/billing"
        />
        <StatTile
          label="AI cost · today"
          value={inr(costTodayInr)}
          sub={`${inr(costMonthInr)} last 30d`}
          href="/app/admin/costs"
        />
        <StatTile
          label="Needs attention"
          value={String(attentionCount)}
          sub={`${pendingVerification} to verify · ${openErasures} erasure · ${openGrievances} grievance`}
          tone={attentionCount > 0 ? 'warn' : 'default'}
          href="/app/admin/compliance"
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="This week">
          <div className="space-y-1">
            <Row label="Real-client sessions · 7d" value={String(sessionsWeek)} />
            <Row label="Suspended accounts" value={String(suspended)} />
            <Row
              label="Care waitlist · waiting"
              value={String(waitlistWaiting)}
              href="/app/admin/care"
            />
          </div>
        </AdminCard>

        <AdminCard
          title="Recent admin actions"
          right={
            <Link
              href="/app/admin/audit"
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              Full audit →
            </Link>
          }
        >
          <Table>
            <Thead
              cols={[{ label: 'Action' }, { label: 'Target' }, { label: 'When', align: 'right' }]}
            />
            <tbody>
              {recentAdminActions.length === 0 ? (
                <EmptyRow colSpan={3}>No admin actions recorded yet.</EmptyRow>
              ) : (
                recentAdminActions.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-mono text-xs">{r.action}</span>
                    </Td>
                    <Td muted>{r.targetType}</Td>
                    <Td align="right" muted>
                      {formatIstDateTime(r.createdAt)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </AdminCard>
      </div>

      <AdminCard title="Jump to" className="mt-4">
        <div className="flex flex-wrap gap-2">
          {[
            ['/app/admin/accounts', 'Accounts'],
            ['/app/admin/billing', 'Billing'],
            ['/app/admin/costs', 'AI costs'],
            ['/app/admin/funnel', 'Growth funnel'],
            ['/app/admin/competency', 'Quality'],
            ['/app/admin/compliance', 'Compliance'],
            ['/app/admin/care', 'Care'],
            ['/app/admin/system', 'System'],
            ['/app/admin/audit', 'Audit'],
            ['/app/admin/invite-codes', 'Invite codes'],
            ['/app/admin/comp', 'Comp an account'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-full border border-[var(--color-line)] bg-white px-3.5 py-1.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              {label}
            </Link>
          ))}
        </div>
      </AdminCard>
    </>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-line-soft)] py-2 text-sm first:border-t-0">
      {href ? (
        <Link href={href} className="text-[var(--color-ink-2)] hover:text-[var(--color-accent)]">
          {label}
        </Link>
      ) : (
        <span className="text-[var(--color-ink-2)]">{label}</span>
      )}
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
