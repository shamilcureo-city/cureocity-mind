import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
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
  return <PractitionerAccountStatus status={me.status} vertical={me.vertical} email={me.email} />;
}
