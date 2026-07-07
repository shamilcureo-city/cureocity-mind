import { SecuritySettingsCard } from '@/components/app/SecuritySettingsCard';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  await requireOnboardedPsychologist(); // defense-in-depth: the /app layout does not redirect
  return <SecuritySettingsCard />;
}
