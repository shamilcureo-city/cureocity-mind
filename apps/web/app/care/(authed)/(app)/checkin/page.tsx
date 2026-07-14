import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { CareCheckinPage } from '@/components/care/CareCheckinPage';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Check-in — Cureocity Care' };
export const dynamic = 'force-dynamic';

/**
 * CG4 — /care/checkin, the daily micro-loop's own address (nudges
 * deep-link here without loading the full home). MoodDial + the one-line
 * reflection against the last report's reflectionPrompt.
 */
export default async function CareCheckinRoute() {
  const user = await requireOnboardedCareUser();
  const lastReport = await prisma.careReport.findFirst({
    where: { careSession: { careUserId: user.id }, kind: 'TREATMENT' },
    orderBy: { createdAt: 'desc' },
    select: { body: true },
  });
  let reflectionPrompt: string | null = null;
  const body = lastReport?.body as Record<string, unknown> | undefined;
  const sr = body?.['sessionReport'] as Record<string, unknown> | undefined;
  if (typeof sr?.['reflectionPrompt'] === 'string' && sr['reflectionPrompt']) {
    reflectionPrompt = sr['reflectionPrompt'];
  }
  return <CareCheckinPage personaName={user.personaName} reflectionPrompt={reflectionPrompt} />;
}
