import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CareReportView } from '@/components/care/CareReportView';

export const metadata: Metadata = { title: 'Your report — Cureocity Care' };
export const dynamic = 'force-dynamic';

// The crisis strip is chrome supplied by the report shell layout now.
export default async function CareReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOnboardedCareUser();
  const { id } = await params;
  return <CareReportView sessionId={id} />;
}
