import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PlanCheckoutButton } from '@/components/app/PlanCheckoutButton';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { ensureBillingAccount, getEntitlement, planAmountInr } from '@/lib/billing';
import { getTherapistMonthlyTotalInr } from '@/lib/cost-guard';
import { prisma } from '@/lib/prisma';
import {
  PLAN_CATALOG,
  intervalMonths,
  planLabel,
  purchasablePlansByTier,
} from '@cureocity/contracts';

export const dynamic = 'force-dynamic';

/**
 * Settings → Plan — Sprint 53 rebuild, Sprint 56 tier ladder.
 *
 * Current plan + trial allowance + AI spend + payment history. When the
 * therapist is on a trial (or lapsed), the Trainee/Starter/Pro/Premium
 * ladder renders from PLAN_CATALOG so prices + tiers stay in one place.
 * Razorpay Checkout opens via the inline PlanCheckoutButton.
 */
export default async function PlanSettingsPage() {
  const me = await requireOnboardedPsychologist();
  await ensureBillingAccount(me.id);

  const [entitlement, monthlySpend, payments] = await Promise.all([
    getEntitlement(me.id),
    getTherapistMonthlyTotalInr(me.id),
    prisma.billingPayment.findMany({
      where: { psychologistId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const sessionCapInr = Number(process.env['COST_CAP_PER_SESSION_INR'] ?? 500);
  const monthlyCapInr = Number(process.env['COST_CAP_PER_THERAPIST_MONTHLY_INR'] ?? 15_000);

  const pct = Math.min(100, Math.round((entitlement.trialUsed / entitlement.trialCap) * 100));
  const isPaid = entitlement.isPaidActive;
  const currentPlanLabel = isPaid ? planLabel(entitlement.plan) : 'Free trial';

  return (
    <div className="space-y-6">
      <Card className="p-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">{currentPlanLabel}</h2>
            {isPaid && entitlement.paidThroughAt && (
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                Renews on{' '}
                {new Date(entitlement.paidThroughAt).toLocaleDateString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                .
              </p>
            )}
            {!isPaid && (
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                Trial sessions are capped — upgrade to keep recording new sessions. Existing notes,
                shares, and the AI copilot keep working at the cap.
              </p>
            )}
          </div>
          <Badge tone={isPaid ? 'accent' : 'muted'}>{isPaid ? 'paid plan' : 'trial'}</Badge>
        </header>

        {!isPaid && (
          <div className="mt-6 max-w-md">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[var(--color-ink-2)]">Sessions recorded</span>
              <span className="tabular-nums font-medium">
                {entitlement.trialUsed} of {entitlement.trialCap}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
              <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </Card>

      {!isPaid && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {purchasablePlansByTier().map((group) => {
            const monthly =
              group.plans.find((p) => PLAN_CATALOG[p].interval === 'MONTHLY') ?? group.plans[0]!;
            const monthlyInr = planAmountInr(monthly);
            const highlight = PLAN_CATALOG[monthly].highlight;
            const longerIntervals = group.plans.filter((p) => p !== monthly);
            return (
              <Card
                key={group.tier}
                className={`flex flex-col p-6 ${
                  highlight ? 'ring-2 ring-[var(--color-accent)]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    {group.tierLabel}
                  </h3>
                  {highlight && <Badge tone="accent">Most popular</Badge>}
                </div>
                <p className="mt-2 font-serif text-3xl">₹{monthlyInr.toLocaleString('en-IN')}</p>
                <p className="text-xs text-[var(--color-ink-3)]">per month</p>
                <p className="mt-2 text-xs text-[var(--color-ink-2)]">{group.blurb}</p>
                <ul className="mt-4 flex-1 space-y-1 text-sm text-[var(--color-ink-2)]">
                  {group.features.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
                <div className="mt-5 space-y-2">
                  <PlanCheckoutButton plan={monthly} label={`Choose ${group.tierLabel}`} />
                  {longerIntervals.map((p) => {
                    const inr = planAmountInr(p);
                    const months = intervalMonths(PLAN_CATALOG[p].interval);
                    const effectiveMonthly = Math.round(inr / months);
                    const save =
                      monthlyInr > 0 ? Math.round((1 - effectiveMonthly / monthlyInr) * 100) : 0;
                    const word = PLAN_CATALOG[p].interval === 'ANNUAL' ? 'year' : 'quarter';
                    return (
                      <PlanCheckoutButton
                        key={p}
                        plan={p}
                        variant="secondary"
                        label={`₹${inr.toLocaleString('en-IN')}/${word}${
                          save > 0 ? ` · save ${save}%` : ''
                        }`}
                      />
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="p-7">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          AI usage this month
        </h3>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--color-ink-3)]">Spend (Gemini)</dt>
            <dd className="mt-1 font-mono text-lg">₹{monthlySpend.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-3)]">Monthly safety cap</dt>
            <dd className="mt-1 font-mono text-lg">₹{monthlyCapInr.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-3)]">Per-session safety cap</dt>
            <dd className="mt-1 font-mono text-lg">₹{sessionCapInr.toLocaleString('en-IN')}</dd>
          </div>
        </dl>
        <p className="mt-4 max-w-xl text-xs text-[var(--color-ink-3)]">
          The safety caps are a cost circuit breaker, not a bill — if a cap is reached, AI passes
          pause for the rest of the period and recording continues unaffected.
        </p>
      </Card>

      {payments.length > 0 && (
        <Card className="p-7">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Payment history
          </h3>
          <ul className="mt-4 divide-y divide-[var(--color-line-soft)]">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[var(--color-ink)]">{planLabel(p.plan)}</p>
                  <p className="text-xs text-[var(--color-ink-3)]">
                    {p.createdAt.toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono tabular-nums text-[var(--color-ink)]">
                    ₹{p.amountInr.toLocaleString('en-IN')}
                  </span>
                  <Badge
                    tone={p.status === 'PAID' ? 'accent' : p.status === 'FAILED' ? 'warn' : 'muted'}
                  >
                    {p.status.toLowerCase()}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
