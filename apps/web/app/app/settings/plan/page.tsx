import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { getTherapistMonthlyTotalInr } from '@/lib/cost-guard';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const FREE_PILOT_SESSION_CAP = 10;

/**
 * Plan & usage — the honest version of the sidebar widget.
 *
 * Shows real numbers (sessions recorded, AI spend this month, the
 * cost-circuit caps that actually protect the account) and is
 * explicit that billing hasn't launched: the pilot is free and
 * nothing is blocked at the session cap yet. Server-side quota
 * enforcement + paid tiers arrive with the billing integration.
 */
export default async function PlanSettingsPage() {
  const me = await requireOnboardedPsychologist();

  const [sessionCount, monthlySpend] = await Promise.all([
    // Sprint 48 — demo "Example" client sessions never count toward
    // the trial allowance.
    prisma.session.count({
      where: { psychologistId: me.id, client: { isDemo: false } },
    }),
    getTherapistMonthlyTotalInr(me.id),
  ]);

  const sessionCapInr = Number(process.env['COST_CAP_PER_SESSION_INR'] ?? 500);
  const monthlyCapInr = Number(process.env['COST_CAP_PER_THERAPIST_MONTHLY_INR'] ?? 15_000);
  const pct = Math.min(100, Math.round((sessionCount / FREE_PILOT_SESSION_CAP) * 100));

  return (
    <div className="space-y-6">
      <Card className="p-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Free pilot</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              You&rsquo;re on the pilot plan. Paid plans with billing are coming — until then,
              recording is not blocked at the session allowance.
            </p>
          </div>
          <Badge tone="accent">current plan</Badge>
        </header>

        <div className="mt-6 max-w-md">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[var(--color-ink-2)]">Sessions recorded</span>
            <span className="tabular-nums font-medium">
              {sessionCount} of {FREE_PILOT_SESSION_CAP}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
            <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>

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
    </div>
  );
}
