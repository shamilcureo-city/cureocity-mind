import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePageCareUser } from '@/lib/care-auth-page';
import { CareOnboardingFlow } from '@/components/care/CareOnboardingFlow';

export const metadata: Metadata = { title: 'Getting set up — Cureocity Care' };
export const dynamic = 'force-dynamic';

export default async function CareOnboardingPage() {
  const user = await requirePageCareUser();
  if (user.onboardedAt !== null) redirect('/care/home');
  return <CareOnboardingFlow initialName={user.displayName === 'Friend' ? '' : user.displayName} />;
}
