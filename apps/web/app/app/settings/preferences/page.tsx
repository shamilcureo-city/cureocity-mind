import { PreferencesSettingsForm } from '@/components/app/PreferencesSettingsForm';
import { requirePagePsychologist } from '@/lib/auth-page';
import { toPsychologist } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function PreferencesSettingsPage() {
  const me = await requirePagePsychologist();
  return <PreferencesSettingsForm initial={toPsychologist(me)} />;
}
