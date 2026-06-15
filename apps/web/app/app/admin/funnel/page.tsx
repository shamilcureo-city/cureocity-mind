import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { requirePageAdmin } from '@/lib/auth-page';
import { planAmountInr } from '@/lib/billing';
import { prisma } from '@/lib/prisma';
import {
  PLAN_CATALOG,
  TIER_ORDER,
  intervalMonths,
  isPaidPlan,
  type BillingPlan,
  type BillingTier,
} from '@cureocity/contracts';

export const dynamic = 'force-dynamic';

/**
 * Sprint 56 (Lever 5) — Acquisition funnel dashboard.
 *
 * Cross-tenant growth roll-up: therapist signup → onboarding →
 * activation (first session, first signed note) → paid conversion, plus
 * live MRR / ARR and signup-month cohorts. Deterministic aggregates over
 * existing tables — no new schema. UTM / per-channel attribution is a
 * follow-up (needs a Psychologist.acquisitionUtm capture at signup).
 *
 * Admin-gated (it lists every therapist's state) via requirePageAdmin.
 */
const PAID_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}
function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export default async function FunnelPage() {
  await requirePageAdmin();
  const graceFloor = new Date(Date.now() - PAID_GRACE_MS);

  const [therapists, activatedRows, signedRows, accounts, trialCapHits, planCapHits, capActorRows] =
    await Promise.all([
      prisma.psychologist.findMany({
        where: { deletedAt: null, role: 'THERAPIST' },
        select: {
          id: true,
          createdAt: true,
          onboardingCompletedAt: true,
          acquisitionUtm: true,
        },
      }),
      // distinct therapists with >=1 real-client session
      prisma.session.findMany({
        where: { client: { isDemo: false } },
        select: { psychologistId: true },
        distinct: ['psychologistId'],
      }),
      // distinct therapists with >=1 signed note (TherapyNote joins via Session)
      prisma.session.findMany({
        where: { therapyNote: { isNot: null } },
        select: { psychologistId: true },
        distinct: ['psychologistId'],
      }),
      prisma.billingAccount.findMany({
        select: { psychologistId: true, plan: true, paidThroughAt: true },
      }),
      prisma.auditLog.count({ where: { action: 'TRIAL_CAP_REACHED' } }),
      prisma.auditLog.count({ where: { action: 'PLAN_CAP_REACHED' } }),
      prisma.auditLog.findMany({
        where: {
          action: { in: ['TRIAL_CAP_REACHED', 'PLAN_CAP_REACHED'] },
          actorPsychologistId: { not: null },
        },
        select: { actorPsychologistId: true },
        distinct: ['actorPsychologistId'],
      }),
    ]);

  const activatedSet = new Set(activatedRows.map((r) => r.psychologistId));
  const signedSet = new Set(signedRows.map((r) => r.psychologistId));

  // Active-paid plan per therapist (mirror getEntitlement.isPaidActive:
  // a non-trial plan whose paidThroughAt + grace is still in the future).
  // Scoped to the THERAPIST set so MRR + the funnel's paid count agree
  // (staff/admin accounts never enter the customer funnel).
  const therapistIds = new Set(therapists.map((t) => t.id));
  const activePaidByPsy = new Map<string, BillingPlan>();
  for (const a of accounts) {
    if (
      therapistIds.has(a.psychologistId) &&
      isPaidPlan(a.plan) &&
      a.paidThroughAt !== null &&
      a.paidThroughAt > graceFloor
    ) {
      activePaidByPsy.set(a.psychologistId, a.plan);
    }
  }

  const signups = therapists.length;
  const onboarded = therapists.filter((t) => t.onboardingCompletedAt !== null).length;
  const activated = therapists.filter((t) => activatedSet.has(t.id)).length;
  const signedNote = therapists.filter((t) => signedSet.has(t.id)).length;
  const paid = therapists.filter((t) => activePaidByPsy.has(t.id)).length;
  const pct = (n: number) => (signups > 0 ? Math.round((n / signups) * 100) : 0);

  // MRR — monthly-equivalent of each active-paid plan's (env-aware) price.
  const monthlyInr = (plan: BillingPlan) =>
    Math.round(planAmountInr(plan) / intervalMonths(PLAN_CATALOG[plan].interval));
  let mrr = 0;
  const tierAgg = new Map<BillingTier, { count: number; mrr: number }>();
  for (const plan of activePaidByPsy.values()) {
    const m = monthlyInr(plan);
    mrr += m;
    const tier = PLAN_CATALOG[plan].tier;
    const cur = tierAgg.get(tier) ?? { count: 0, mrr: 0 };
    tierAgg.set(tier, { count: cur.count + 1, mrr: cur.mrr + m });
  }
  const arr = mrr * 12;
  // Show the ladder tiers always, plus any legacy tier (SOLO) that has payers.
  const tierRows: BillingTier[] = [
    ...TIER_ORDER,
    ...[...tierAgg.keys()].filter((t) => !TIER_ORDER.includes(t)),
  ];

  // Signup-month cohorts (last 6).
  const cohortMap = new Map<string, { signups: number; onboarded: number; paid: number }>();
  for (const t of therapists) {
    const k = monthKey(t.createdAt);
    const c = cohortMap.get(k) ?? { signups: 0, onboarded: 0, paid: 0 };
    c.signups += 1;
    if (t.onboardingCompletedAt) c.onboarded += 1;
    if (activePaidByPsy.has(t.id)) c.paid += 1;
    cohortMap.set(k, c);
  }
  const cohorts = [...cohortMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);

  // Sprint 56 (Lever 3a) — top acquisition sources by signups + paid
  // conversion. Reads Psychologist.acquisitionUtm captured at signup;
  // null rows fall into the '(direct / unknown)' bucket.
  const sourceMap = new Map<string, { signups: number; paid: number }>();
  for (const t of therapists) {
    const utm = t.acquisitionUtm as { utm_source?: string } | null;
    const key = utm?.utm_source?.toLowerCase().trim() || '(direct / unknown)';
    const s = sourceMap.get(key) ?? { signups: 0, paid: 0 };
    s.signups += 1;
    if (activePaidByPsy.has(t.id)) s.paid += 1;
    sourceMap.set(key, s);
  }
  const sources = [...sourceMap.entries()].sort((a, b) => b[1].signups - a[1].signups).slice(0, 8);

  const funnel = [
    { label: 'Signed up', value: signups, pct: 100 },
    { label: 'Onboarded', value: onboarded, pct: pct(onboarded) },
    { label: 'Activated (≥1 session)', value: activated, pct: pct(activated) },
    { label: 'Signed ≥1 note', value: signedNote, pct: pct(signedNote) },
    { label: 'Paying (active)', value: paid, pct: pct(paid) },
  ];

  return (
    <Container className="py-10">
      <Link href="/app" className="text-sm text-[var(--color-accent)] hover:underline">
        ← Dashboard
      </Link>
      <header className="mt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Admin · growth
        </p>
        <h1 className="mt-1 font-serif text-3xl">Acquisition funnel</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Therapist signup → activation → paid conversion, with live MRR / ARR. Deterministic over
          existing data; cohorts bucketed by signup month. Per-channel (UTM) attribution is a
          follow-up.
        </p>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="MRR" value={`₹${mrr.toLocaleString('en-IN')}`} sub={`${paid} paying therapists`} highlight />
        <StatTile label="ARR run-rate" value={`₹${arr.toLocaleString('en-IN')}`} sub="MRR × 12" />
        <StatTile label="Trial → paid" value={`${pct(paid)}%`} sub={`${paid} of ${signups} signups`} />
      </div>

      <Card className="mt-6 p-7">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Funnel</h2>
        <ul className="mt-4 space-y-3">
          {funnel.map((s) => (
            <li key={s.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-[var(--color-ink-2)]">{s.label}</span>
                <span className="tabular-nums font-medium">
                  {s.value} · {s.pct}%
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
                <div className="h-full bg-[var(--color-accent)]" style={{ width: `${s.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--color-ink-3)]">
          {trialCapHits + planCapHits} cap-limit hits ({trialCapHits} trial · {planCapHits} plan)
          across {capActorRows.length} therapists — upgrade-intent moments worth a nudge.
        </p>
      </Card>

      <Card className="mt-6 p-7">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Paid mix</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th className="pb-2">Tier</th>
              <th className="pb-2 text-right">Therapists</th>
              <th className="pb-2 text-right">MRR</th>
            </tr>
          </thead>
          <tbody>
            {tierRows.map((tier) => {
              const agg = tierAgg.get(tier) ?? { count: 0, mrr: 0 };
              return (
                <tr key={tier} className="border-t border-[var(--color-line-soft)]">
                  <td className="py-2">{titleCase(tier)}</td>
                  <td className="py-2 text-right tabular-nums">{agg.count}</td>
                  <td className="py-2 text-right tabular-nums">₹{agg.mrr.toLocaleString('en-IN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="mt-6 p-7">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Top acquisition sources
        </h2>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          Captured at signup from the marketing-landing URL params. Rows for past signups (pre-S56)
          fall into the direct/unknown bucket.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th className="pb-2">Source</th>
              <th className="pb-2 text-right">Signups</th>
              <th className="pb-2 text-right">Paid</th>
              <th className="pb-2 text-right">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-[var(--color-ink-3)]">
                  No signups yet.
                </td>
              </tr>
            ) : (
              sources.map(([source, s]) => (
                <tr key={source} className="border-t border-[var(--color-line-soft)]">
                  <td className="py-2">{source}</td>
                  <td className="py-2 text-right tabular-nums">{s.signups}</td>
                  <td className="py-2 text-right tabular-nums">{s.paid}</td>
                  <td className="py-2 text-right tabular-nums">
                    {s.signups > 0 ? Math.round((s.paid / s.signups) * 100) : 0}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="mt-6 p-7">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Signup cohorts (last 6 months)
        </h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-3)]">
              <th className="pb-2">Month</th>
              <th className="pb-2 text-right">Signups</th>
              <th className="pb-2 text-right">Onboarded</th>
              <th className="pb-2 text-right">Paid</th>
              <th className="pb-2 text-right">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-[var(--color-ink-3)]">
                  No signups yet.
                </td>
              </tr>
            ) : (
              cohorts.map(([month, c]) => (
                <tr key={month} className="border-t border-[var(--color-line-soft)]">
                  <td className="py-2">{month}</td>
                  <td className="py-2 text-right tabular-nums">{c.signups}</td>
                  <td className="py-2 text-right tabular-nums">{c.onboarded}</td>
                  <td className="py-2 text-right tabular-nums">{c.paid}</td>
                  <td className="py-2 text-right tabular-nums">
                    {c.signups > 0 ? Math.round((c.paid / c.signups) * 100) : 0}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </Container>
  );
}

function StatTile({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        highlight
          ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
          : 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <p className="mt-1 font-serif text-3xl tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--color-ink-3)]">{sub}</p>}
    </div>
  );
}
