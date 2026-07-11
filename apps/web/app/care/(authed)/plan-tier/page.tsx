import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CARE_TIER_WEEKLY_CAP } from '@/lib/care-gate';
import { Card } from '@/components/ui/Card';
import { SafetyStrip } from '@/components/care/SafetyStrip';

export const metadata: Metadata = { title: 'Your plan — Cureocity Care' };
export const dynamic = 'force-dynamic';

/**
 * S8 — tier state. Caps are enforced server-side at session-create from
 * AC3; the Razorpay checkout wires in once the pricing decision (#3,
 * docs/AI_COUNSELING.md §14) is made — the mechanism (planTier + gate)
 * is already live.
 */
export default async function CarePlanTierPage() {
  const user = await requireOnboardedCareUser();
  const freeCap = CARE_TIER_WEEKLY_CAP['free']!;
  const plusCap = CARE_TIER_WEEKLY_CAP['plus']!;
  return (
    <>
      <div className="mx-auto max-w-md px-5 py-6 pb-24">
        <h1 className="font-serif text-2xl font-semibold">Your plan</h1>
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              Free
            </span>
            {user.planTier === 'free' ? (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                current
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            Intake + assessment &amp; plan free · {freeCap} sessions / week · full reports
          </p>
        </Card>
        <Card className="mt-3 border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent)]">
              Care Plus
            </span>
            {user.planTier === 'plus' ? (
              <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                current
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            {plusCap} sessions / week · longer sessions · weekly digest · all voices
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-2)]">
            Pricing is being finalised — upgrades open soon. Your data and reports stay yours on any
            tier.
          </p>
        </Card>
      </div>
      <SafetyStrip resources={crisisResources(user.spokenLanguages)} />
    </>
  );
}
