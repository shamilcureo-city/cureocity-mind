import Link from 'next/link';
import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  DefRow,
  Pill,
  Table,
  Thead,
  Tr,
  Td,
  EmptyRow,
  inr,
  type PillTone,
} from '@/components/console/AdminUI';
import { planAmountInr } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import { formatIstDateTime } from '@/lib/ist';
import { requirePageAdmin } from '@/lib/auth-page';
import {
  PLAN_CATALOG,
  TIER_ORDER,
  intervalMonths,
  isPaidPlan,
  planTierLabel,
  type BillingPlan,
  type BillingTier,
} from '@cureocity/contracts';

export const dynamic = 'force-dynamic';

/**
 * Super-admin — revenue + billing operations overview. Deterministic
 * roll-up over BillingAccount + BillingPayment: live MRR / ARR, the paid
 * mix by tier, recent payment attempts (incl. failures), and account-state
 * counts. Read-only; no new schema, no mutations. Page guard + Container +
 * nav live in the admin layout — this component returns page content only.
 */
const PAID_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Monthly-equivalent of a plan's (env-aware) price, mirroring the funnel page.
function monthlyInr(plan: BillingPlan): number {
  return Math.round(planAmountInr(plan) / intervalMonths(PLAN_CATALOG[plan].interval));
}

const PAYMENT_TONE: Record<'PAID' | 'FAILED' | 'CREATED', PillTone> = {
  PAID: 'good',
  FAILED: 'danger',
  CREATED: 'muted',
};

export default async function AdminBillingPage() {
  await requirePageAdmin();
  const now = Date.now();
  const graceFloor = new Date(now - PAID_GRACE_MS);
  const since30 = new Date(now - THIRTY_DAYS_MS);

  const [accounts, revenue30d, recentPayments] = await Promise.all([
    prisma.billingAccount.findMany({
      select: { plan: true, paidThroughAt: true, status: true },
    }),
    prisma.billingPayment.aggregate({
      _sum: { amountInr: true },
      where: { status: 'PAID', createdAt: { gte: since30 } },
    }),
    prisma.billingPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        plan: true,
        amountInr: true,
        status: true,
        createdAt: true,
        razorpayPaymentId: true,
      },
    }),
  ]);

  // Active-paid = a non-trial plan whose paidThroughAt is still within grace.
  let mrr = 0;
  let payingCount = 0;
  const tierAgg = new Map<BillingTier, { count: number; mrr: number }>();
  // Account-state + trial counts (over ALL accounts, active-paid or not).
  const statusCounts = { ACTIVE: 0, PAUSED: 0, CANCELLED: 0 };
  let trialCount = 0;

  for (const a of accounts) {
    statusCounts[a.status] += 1;
    if (a.plan === 'FREE_TRIAL') trialCount += 1;

    const activePaid =
      isPaidPlan(a.plan) && a.paidThroughAt !== null && a.paidThroughAt > graceFloor;
    if (!activePaid) continue;

    const m = monthlyInr(a.plan);
    mrr += m;
    payingCount += 1;
    const tier = PLAN_CATALOG[a.plan].tier;
    const cur = tierAgg.get(tier) ?? { count: 0, mrr: 0 };
    tierAgg.set(tier, { count: cur.count + 1, mrr: cur.mrr + m });
  }
  const arr = mrr * 12;
  const revenueCollected30d = Number(revenue30d._sum.amountInr ?? 0);

  // Ladder tiers always, plus any legacy tier (e.g. SOLO) that has payers.
  const tierRows: BillingTier[] = [
    ...TIER_ORDER,
    ...[...tierAgg.keys()].filter((t) => !TIER_ORDER.includes(t)),
  ];

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Billing & revenue"
        description="Live MRR / ARR, the paid mix by tier, recent payment attempts, and account states. Deterministic over BillingAccount + BillingPayment; amounts in INR."
      />

      <StatGrid>
        <StatTile
          label="MRR"
          value={inr(mrr)}
          sub={`${payingCount} paying accounts`}
          tone="accent"
        />
        <StatTile label="ARR run-rate" value={inr(arr)} sub="MRR × 12" />
        <StatTile
          label="Paying accounts"
          value={String(payingCount)}
          sub="active-paid (in grace)"
        />
        <StatTile
          label="Collected · 30d"
          value={inr(revenueCollected30d)}
          sub="PAID payments, last 30 days"
          tone={revenueCollected30d > 0 ? 'good' : 'default'}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Paid mix" hint="Active-paid accounts by tier (monthly-equivalent MRR)">
          <Table>
            <Thead
              cols={[
                { label: 'Tier' },
                { label: 'Accounts', align: 'right' },
                { label: 'MRR', align: 'right' },
              ]}
            />
            <tbody>
              {tierRows.map((tier) => {
                const agg = tierAgg.get(tier) ?? { count: 0, mrr: 0 };
                return (
                  <Tr key={tier}>
                    <Td>{titleCase(tier)}</Td>
                    <Td align="right" nums>
                      {agg.count}
                    </Td>
                    <Td align="right" nums>
                      {inr(agg.mrr)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard title="Account states" hint="All BillingAccount rows by lifecycle status">
          <div className="space-y-0">
            <DefRow label="Active">{statusCounts.ACTIVE}</DefRow>
            <DefRow label="Paused">{statusCounts.PAUSED}</DefRow>
            <DefRow label="Cancelled">{statusCounts.CANCELLED}</DefRow>
            <DefRow label="On free trial">{trialCount}</DefRow>
            <DefRow label="Total accounts">{accounts.length}</DefRow>
          </div>
        </AdminCard>
      </div>

      <div className="mt-4">
        <AdminCard
          title="Recent payments"
          hint="Last 15 payment attempts — failures and open orders included"
        >
          <Table>
            <Thead
              cols={[
                { label: 'Status' },
                { label: 'Tier' },
                { label: 'Amount', align: 'right' },
                { label: 'When', align: 'right' },
              ]}
            />
            <tbody>
              {recentPayments.length === 0 ? (
                <EmptyRow colSpan={4}>No payments yet.</EmptyRow>
              ) : (
                recentPayments.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Pill tone={PAYMENT_TONE[p.status]}>{p.status}</Pill>
                    </Td>
                    <Td>{planTierLabel(p.plan)}</Td>
                    <Td align="right" nums>
                      {inr(Number(p.amountInr))}
                    </Td>
                    <Td align="right" nums muted>
                      {formatIstDateTime(p.createdAt)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            Comps / manual grants don&rsquo;t create a payment row — they appear as{' '}
            <code className="text-[var(--color-ink-2)]">PLAN_UPGRADED</code> audit rows with{' '}
            <code className="text-[var(--color-ink-2)]">metadata.comp=true</code>. See the{' '}
            <Link href="/console/audit" className="text-[var(--color-accent)] hover:underline">
              audit log
            </Link>
            .
          </p>
        </AdminCard>
      </div>
    </>
  );
}
