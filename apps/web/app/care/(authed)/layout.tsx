import type { ReactNode } from 'react';
import { requirePageCareUser } from '@/lib/care-auth-page';

/**
 * The authed /care surface (AC1). Everything under this layout requires
 * a resolved CareUser — a practitioner cookie never gets in (the guard
 * resolves through the care_users table only). Onboarding routing is
 * enforced per-page (the onboarding page must stay reachable).
 */
export default async function CareAuthedLayout({ children }: { children: ReactNode }) {
  await requirePageCareUser();
  return <div className="min-h-screen bg-[var(--color-bg)]">{children}</div>;
}
