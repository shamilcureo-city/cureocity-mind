'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { PlanCheckoutButton } from './PlanCheckoutButton';
import { useModalA11y } from '@/lib/use-modal-a11y';
import {
  PLAN_CATALOG,
  TIER_COPY,
  TIER_ORDER,
  type BillingEntitlement,
  type BillingTier,
  type PurchasablePlan,
} from '@cureocity/contracts';

/**
 * Sprint 53 created this as a "see plans" hand-off; Sprint 56 turns it
 * into the highest-leverage conversion point in the funnel — a one-click
 * upgrade with embedded Razorpay Checkout, no navigation. Same surface
 * handles both kinds of 402 returned by POST /sessions:
 *
 *   TRIAL_CAP_REACHED  — free trial exhausted; show all four tiers,
 *                        anchor on Pro, no plan downgrade story.
 *   PLAN_CAP_REACHED   — paid Trainee/Starter hit the rolling-30-day
 *                        cap; show Pro + Premium prominently with
 *                        "your <Tier> plan caps at N a month" framing.
 *
 * The session-create gate now ships its entitlement snapshot inline on
 * the 402 (no extra fetch). The three creation surfaces (RecordConfirm-
 * Strip, NewClientForm, ScheduleSessionPanel) pass that through.
 */
type Variant = 'TRIAL_CAP' | 'PLAN_CAP';

interface Props {
  open: boolean;
  onClose: () => void;
  variant: Variant;
  entitlement: BillingEntitlement;
}

/** Plan to highlight as the obvious next step for this variant. */
const RECOMMENDED: Record<Variant, PurchasablePlan> = {
  TRIAL_CAP: 'PRO_MONTHLY',
  PLAN_CAP: 'PRO_MONTHLY', // Pro is the unlimited upgrade from a capped paid tier
};

export function UpgradeModal({ open, onClose, variant, entitlement }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(open, dialogRef, onClose);
  if (!open) return null;
  const recommendedTier = PLAN_CATALOG[RECOMMENDED[variant]].tier;
  // For PLAN_CAP we suppress the user's own (capped) tier so they don't
  // see "stay on Trainee" as an option; for TRIAL_CAP we show the full
  // ladder so price-sensitive trainees still see the ₹499 entry point.
  const currentTier = PLAN_CATALOG[entitlement.plan]?.tier;
  const tiersToShow: BillingTier[] = TIER_ORDER.filter((t) =>
    variant === 'PLAN_CAP' ? t !== currentTier : true,
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-3xl border border-[var(--color-line)] bg-white p-7 shadow-2xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
              {variant === 'TRIAL_CAP' ? 'Trial cap reached' : 'Plan cap reached'}
            </p>
            <h2 className="mt-2 font-serif text-2xl text-[var(--color-ink)]">
              {variant === 'TRIAL_CAP'
                ? 'Time to upgrade to keep recording'
                : `You've recorded ${entitlement.monthlyUsed} sessions in the last 30 days`}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {variant === 'TRIAL_CAP' ? (
                <>
                  You&rsquo;ve used all {entitlement.trialCap} free-trial sessions. Existing notes,
                  shares, and the AI Copilot keep working — only new session recording is paused.
                </>
              ) : (
                <>
                  Your {TIER_COPY[currentTier ?? 'STARTER'].tierLabel} plan caps at{' '}
                  {entitlement.monthlySessionCap} sessions a month. Upgrade to Pro for unlimited
                  sessions and keep recording.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            ×
          </button>
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiersToShow.map((tier) => {
            const monthlyPlan = `${tier}_MONTHLY` as PurchasablePlan;
            const spec = PLAN_CATALOG[monthlyPlan];
            const recommended = tier === recommendedTier;
            return (
              <div
                key={tier}
                className={`flex flex-col rounded-2xl border p-4 ${
                  recommended
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-line-soft)] bg-[var(--color-surface)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                    {TIER_COPY[tier].tierLabel}
                  </p>
                  {recommended && (
                    <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-2 font-serif text-2xl tabular-nums">
                  ₹{spec.defaultPriceInr.toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-[var(--color-ink-3)]">per month</p>
                <p className="mt-2 text-xs text-[var(--color-ink-2)]">
                  {spec.monthlySessionCap === null
                    ? 'Unlimited sessions'
                    : `Up to ${spec.monthlySessionCap} sessions / month`}
                </p>
                <div className="mt-4 mt-auto">
                  <PlanCheckoutButton
                    plan={monthlyPlan}
                    variant={recommended ? 'primary' : 'secondary'}
                    label="Choose"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link
            href="/app/settings/plan"
            className="text-[var(--color-accent)] hover:underline"
            onClick={onClose}
          >
            See all plans & intervals →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            Not now
          </button>
        </footer>
      </div>
    </div>
  );
}
