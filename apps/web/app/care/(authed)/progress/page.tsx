import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareProgress } from '@/components/care/CareProgress';
import { SafetyStrip } from '@/components/care/SafetyStrip';

export const metadata: Metadata = { title: 'Progress — Cureocity Care' };
export const dynamic = 'force-dynamic';

export default async function CareProgressPage() {
  const user = await requireOnboardedCareUser();
  return (
    <>
      <CareProgress />
      <SafetyStrip resources={crisisResources(user.spokenLanguages)} />
    </>
  );
}
