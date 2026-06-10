import { AccountSettingsForm } from '@/components/app/AccountSettingsForm';
import { requirePagePsychologist } from '@/lib/auth-page';
import { toPsychologist } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const me = await requirePagePsychologist();
  return <AccountSettingsForm initial={toPsychologist(me)} />;
}
