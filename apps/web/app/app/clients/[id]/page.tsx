import { redirect } from 'next/navigation';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/** @deprecated ORBIT uses the canonical Patient workspace. */
export default async function LegacyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOnboardedPsychologist();
  const { id } = await params;
  redirect(`/app/patients/${id}`);
}
