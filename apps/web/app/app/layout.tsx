import type { ReactNode } from 'react';
import { MobileNav } from '@/components/app/MobileNav';
import { Sidebar, type PlanUsage } from '@/components/app/Sidebar';
import { currentPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/// Free-pilot session allowance shown in the sidebar plan widget.
/// Display-only today; server-side enforcement lands with billing.
const FREE_PILOT_SESSION_CAP = 10;

/**
 * Authenticated scribe shell. Sidebar on md+, bottom tab bar on
 * phones. Page-level guards (`requireOnboardedPsychologist`) handle
 * the actual redirect to /login or /onboarding; the layout only
 * resolves the identity to feed the plan widget, and renders fine
 * when unauthenticated (the child page redirects before content
 * matters).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const psy = await currentPsychologist();
  const usage: PlanUsage | null = psy
    ? {
        used: await prisma.session.count({ where: { psychologistId: psy.id } }),
        cap: FREE_PILOT_SESSION_CAP,
      }
    : null;

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar usage={usage} />
      <div className="flex flex-1 flex-col pb-16 md:pb-0">{children}</div>
      <MobileNav />
    </div>
  );
}
