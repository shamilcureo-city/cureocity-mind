import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { productFromHost } from '@/lib/product';
import { PractitionerAccountStatus } from '@/components/app/PractitionerAccountStatus';
import { requirePagePsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Account access | Cureocity',
  robots: { index: false, follow: false },
};

/** Outside the clinical shell: no patient reads, plan fetches or clinical UI. */
export default async function AccountStatusPage() {
  const me = await requirePagePsychologist();
  if (me.status === 'ACTIVE') redirect('/app');
  const pendingScribe =
    me.status === 'PENDING_VERIFICATION' &&
    me.onboardingCompletedAt === null &&
    productFromHost((await headers()).get('host')).key === 'scribe';
  return (
    <PractitionerAccountStatus
      status={me.status}
      vertical={pendingScribe ? 'DOCTOR' : me.vertical}
      email={me.email}
      canSubmitRegistration={pendingScribe}
    />
  );
}
