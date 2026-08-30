import { redirect } from 'next/navigation';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string; session?: string; capture?: 'LIVE' | 'BATCH' }>;
}) {
  const practitioner = await requireOnboardedPsychologist();
  if (practitioner.vertical === 'DOCTOR') redirect('/app/clinic');

  const params = await searchParams;
  const deepLink = new URLSearchParams();
  if (params.record) deepLink.set('record', params.record);
  if (params.session) deepLink.set('session', params.session);
  if (params.capture) deepLink.set('capture', params.capture);
  if (deepLink.size > 0) redirect(`/app/encounters/new?${deepLink.toString()}`);

  redirect('/app/today');
}
