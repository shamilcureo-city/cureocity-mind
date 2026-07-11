import type { Metadata } from 'next';
import { requirePageCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareSettings } from '@/components/care/CareSettings';
import { SafetyStrip } from '@/components/care/SafetyStrip';

export const metadata: Metadata = { title: 'Settings — Cureocity Care' };
export const dynamic = 'force-dynamic';

// requirePageCareUser (not the onboarded variant): the safety-resume
// check-in on this page must stay reachable for a held account.
export default async function CareSettingsPage() {
  const user = await requirePageCareUser();
  const resources = crisisResources(user.spokenLanguages);
  return (
    <>
      <CareSettings resources={resources} />
      <SafetyStrip resources={resources} />
    </>
  );
}
