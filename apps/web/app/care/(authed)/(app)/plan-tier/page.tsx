import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CARE_TIER_WEEKLY_CAP, effectiveCareTier } from '@/lib/care-gate';
import { carePlusMonthlyInr } from '@/lib/care-pricing';
import { evaluateCareSuppression } from '@/lib/care-suppression';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui/Card';
import { CarePlusCheckout } from '@/components/care/CarePlusCheckout';

export const metadata: Metadata = { title: 'Your plan — Cureocity Care' };
export const dynamic = 'force-dynamic';

/**
 * CG3 — plan-tier v2 (docs/CARE_GROWTH_SYSTEM.md §7). The honest ladder:
 * Free is marketed, not hidden (it IS the acquisition story); Plus sells
 * ONLY what the gate enforces (4 sessions/week, prepaid 30 days, nothing
 * recurring); the price anchor never renders without the non-equivalence
 * line; the safety-free guarantee is printed as a trust feature. The
 * suppression predicate gates the checkout here AND server-side in the
 * checkout route (ethics charter #2).
 */
export default async function CarePlanTierPage() {
  const user = await requireOnboardedCareUser();
  const freeCap = CARE_TIER_WEEKLY_CAP['free']!;
  const plusCap = CARE_TIER_WEEKLY_CAP['plus']!;
  const priceInr = carePlusMonthlyInr();

  const [row, lastCrisis, latestReport] = await Promise.all([
    prisma.careUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { planTier: true, planExpiresAt: true, status: true, safetyHoldAt: true },
    }),
    prisma.careSession.findFirst({
      where: { careUserId: user.id, crisisAt: { not: null } },
      orderBy: { crisisAt: 'desc' },
      select: { crisisAt: true },
    }),
    prisma.careReport.findFirst({
      where: { careSession: { careUserId: user.id } },
      orderBy: { createdAt: 'desc' },
      select: { riskLevel: true },
    }),
  ]);
  const tier = effectiveCareTier(row.planTier, row.planExpiresAt);
  const suppression = evaluateCareSuppression({
    status: row.status,
    safetyHoldAt: row.safetyHoldAt,
    lastCrisisAt: lastCrisis?.crisisAt ?? null,
    latestRiskLevel: latestReport?.riskLevel ?? null,
    worseningVerdict: false,
  });

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-3xl md:px-8 md:py-10">
      <h1 className="font-serif text-2xl font-semibold md:text-3xl">Your plan</h1>
      <div className="mt-4 grid gap-3 md:mt-6 md:grid-cols-2">
        <Card className="p-4 md:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Free — forever
            </span>
            {tier === 'free' ? (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                current
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            Your intake, your assessment &amp; plan, {freeCap} sessions every week, every report,
            your progress — free. Not a trial.
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-3)]">
            {freeCap} sessions a week is more than most weekly therapy.
          </p>
        </Card>
        <Card className="border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4 md:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">
              Care Plus
            </span>
            {tier === 'plus' ? (
              <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                current
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            Up to {plusCap} sessions a week — double the pace, for the heavy stretches.
          </p>
          {tier === 'plus' && row.planExpiresAt ? (
            <p className="mt-2 text-xs text-[var(--color-ink-2)]">
              Active until{' '}
              {row.planExpiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. It
              ends on its own — no auto-renewal. Top up any time.
            </p>
          ) : null}
          {suppression.suppress ? (
            <p className="mt-3 text-xs text-[var(--color-ink-2)]">
              Upgrades are paused right now — your sessions and safety support are unaffected and
              free.
            </p>
          ) : (
            <div className="mt-3">
              <CarePlusCheckout priceInr={priceInr} />
            </div>
          )}
        </Card>
      </div>
      <p className="mt-4 text-[13px] text-[var(--color-ink-2)]">
        Human therapy in India runs ₹800–3,500 a session. Care Plus covers a whole month for less
        than one human hour — and to be clear:{' '}
        <b>Care is an AI, not a replacement for a therapist</b>. That&apos;s part of why it costs
        less.
      </p>
      <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">
        Everything safety-related is free on every tier. Always. Your reports, plan, and history are
        yours on any tier — and export is one tap in Settings.
      </p>
    </div>
  );
}
