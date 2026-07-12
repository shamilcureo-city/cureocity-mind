import type { ReactNode } from 'react';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareAppShell } from '@/components/care/CareAppShell';

/**
 * The signed-in /care web shell wraps every non-immersive app screen —
 * home, progress, plan, settings (this `(app)` group) — in the desktop
 * sidebar + mobile top bar. The live voice session and onboarding sit
 * OUTSIDE this group (full-bleed by design); the post-session report
 * gets the shell via its own nested layout.
 */
export default async function CareAppShellLayout({ children }: { children: ReactNode }) {
  const user = await requireOnboardedCareUser();
  return (
    <CareAppShell resources={crisisResources(user.spokenLanguages)} personaName={user.personaName}>
      {children}
    </CareAppShell>
  );
}
