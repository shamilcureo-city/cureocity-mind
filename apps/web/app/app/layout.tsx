import type { ReactNode } from 'react';
import { MobileNav } from '@/components/app/MobileNav';
import { Sidebar, type PlanUsage } from '@/components/app/Sidebar';
import { currentPsychologist } from '@/lib/auth-page';
import { getEntitlement } from '@/lib/billing';

export const dynamic = 'force-dynamic';

/**
 * Authenticated scribe shell. Sidebar on md+, bottom tab bar on
 * phones. Page-level guards (`requireOnboardedPsychologist`) handle
 * the actual redirect to /login or /onboarding; the layout only
 * resolves the identity to feed the plan widget, and renders fine
 * when unauthenticated (the child page redirects before content
 * matters).
 *
 * Sprint 53 — the PlanUsage feed now comes from getEntitlement so the
 * cap is real (BillingAccount.trialSessionCap) and the widget flips
 * to "Solo · renews <date>" when the therapist is on a paid plan.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const psy = await currentPsychologist();
  let usage: PlanUsage | null = null;
  if (psy) {
    const ent = await getEntitlement(psy.id);
    usage = {
      used: ent.trialUsed,
      cap: ent.trialCap,
      plan: ent.plan,
      paidThroughAt: ent.paidThroughAt,
    };
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar usage={usage} />
      <div className="flex flex-1 flex-col pb-16 md:pb-0">{children}</div>
      <MobileNav />
    </div>
  );
}
