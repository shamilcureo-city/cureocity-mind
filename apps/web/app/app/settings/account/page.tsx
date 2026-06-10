import { AccountSettingsForm } from '@/components/app/AccountSettingsForm';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { toPsychologist } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const me = await requireOnboardedPsychologist();
  return <AccountSettingsForm initial={toPsychologist(me)} />;
}
