import { notFound } from 'next/navigation';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { ReceptionWorkspace } from '@/components/reception/ReceptionWorkspace';

export const dynamic = 'force-dynamic';

export default async function ReceptionPage() {
  if (process.env['RECEPTION_PILOT_ENABLED'] !== 'true') notFound();
  const practitioner = await requireOnboardedPsychologist();
  return <ReceptionWorkspace vertical={practitioner.vertical} />;
}
