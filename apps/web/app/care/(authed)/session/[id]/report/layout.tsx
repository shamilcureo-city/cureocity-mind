import type { ReactNode } from 'react';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareAppShell } from '@/components/care/CareAppShell';

/**
 * The post-session report is a reading/review screen, so it wears the
 * web shell (sidebar + safety chrome) — unlike its sibling `page.tsx`,
 * the live voice session, which is a full-bleed immersive surface with
 * no layout of its own.
 */
export default async function CareReportShellLayout({ children }: { children: ReactNode }) {
  const user = await requireOnboardedCareUser();
  return (
    <CareAppShell resources={crisisResources(user.spokenLanguages)} personaName={user.personaName}>
      {children}
    </CareAppShell>
  );
}
