import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CareProgress } from '@/components/care/CareProgress';

export const metadata: Metadata = { title: 'Progress — Cureocity Care' };
export const dynamic = 'force-dynamic';

// The crisis strip is chrome supplied by the (app) shell layout now.
export default async function CareProgressPage() {
  await requireOnboardedCareUser();
  return <CareProgress />;
}
