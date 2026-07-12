import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CareHome } from '@/components/care/CareHome';

export const metadata: Metadata = { title: 'Home — Cureocity Care' };
export const dynamic = 'force-dynamic';

export default async function CareHomePage() {
  await requireOnboardedCareUser();
  return <CareHome />;
}
