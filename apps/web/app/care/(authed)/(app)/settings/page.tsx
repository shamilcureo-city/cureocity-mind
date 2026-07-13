import type { Metadata } from 'next';
import { requirePageCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareSettings } from '@/components/care/CareSettings';

export const metadata: Metadata = { title: 'Settings — Cureocity Care' };
export const dynamic = 'force-dynamic';

// requirePageCareUser (not the onboarded variant): the safety-resume
// check-in on this page must stay reachable for a held account (which is
// always onboarded, so the (app) shell layout's onboarded guard passes).
// `resources` still feeds the in-page SAFETY_HOLD card; the fixed crisis
// strip is supplied by the shell layout.
export default async function CareSettingsPage() {
  const user = await requirePageCareUser();
  return <CareSettings resources={crisisResources(user.spokenLanguages)} />;
}
