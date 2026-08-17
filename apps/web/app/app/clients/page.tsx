import { redirect } from 'next/navigation';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  status?: string;
  cursor?: string;
}

/** @deprecated ORBIT uses the canonical /app/patients roster. */
export default async function LegacyClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOnboardedPsychologist();
  const params = new URLSearchParams();
  const input = await searchParams;
  if (input.q) params.set('q', input.q);
  if (input.status) params.set('status', input.status);
  if (input.cursor) params.set('cursor', input.cursor);
  redirect(`/app/patients${params.size ? `?${params.toString()}` : ''}`);
}
