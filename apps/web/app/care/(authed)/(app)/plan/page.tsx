import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CarePlanView } from '@/components/care/CarePlanView';

export const metadata: Metadata = { title: 'Your plan — Cureocity Care' };
export const dynamic = 'force-dynamic';

// The crisis strip is chrome supplied by the (app) shell layout.
export default async function CarePlanPage() {
  await requireOnboardedCareUser();
  return <CarePlanView />;
}
