import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CareReportView } from '@/components/care/CareReportView';
import { SafetyStrip } from '@/components/care/SafetyStrip';

export const metadata: Metadata = { title: 'Your report — Cureocity Care' };
export const dynamic = 'force-dynamic';

export default async function CareReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOnboardedCareUser();
  const { id } = await params;
  return (
    <>
      <CareReportView sessionId={id} />
      <SafetyStrip resources={crisisResources(user.spokenLanguages)} />
    </>
  );
}
