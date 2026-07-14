import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { BaselineCheckin } from '@/components/care/BaselineCheckin';

export const metadata: Metadata = { title: 'Your starting line — Cureocity Care' };
export const dynamic = 'force-dynamic';

/**
 * CG1 — the standalone home for the starting-line PHQ-9 (the home card's
 * "Take it now" destination). The primary ask lives post-plan-accept on the
 * report screen; this page is the later door for users who tapped
 * "Later is fine" there.
 */
export default async function CareBaselinePage() {
  await requireOnboardedCareUser();
  return <BaselineCheckin />;
}
