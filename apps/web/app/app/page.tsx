import { redirect } from 'next/navigation';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/** ORBIT Sprint 4 — Today is the single authenticated home. */
export default async function AppHomePage() {
  await requireOnboardedPsychologist();
  redirect('/app/today');
}
