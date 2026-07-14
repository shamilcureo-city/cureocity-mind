import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireOnboardedCareUser } from '@/lib/care-auth-page';
import { crisisResources } from '@/lib/care-safety';
import { CARE_SESSION_CAP_MIN } from '@cureocity/llm';
import { prisma } from '@/lib/prisma';
import { CareSessionFlow } from '@/components/care/CareSessionFlow';

export const metadata: Metadata = { title: 'Session — Cureocity Care' };
export const dynamic = 'force-dynamic';

export default async function CareSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOnboardedCareUser();
  const { id } = await params;
  const session = await prisma.careSession.findUnique({
    where: { id },
    select: { id: true, careUserId: true, kind: true, status: true },
  });
  if (!session || session.careUserId !== user.id) notFound();

  return (
    <CareSessionFlow
      sessionId={session.id}
      kind={session.kind}
      capMin={CARE_SESSION_CAP_MIN[session.kind]}
      personaName={user.personaName}
      resources={crisisResources(user.spokenLanguages)}
      trustedContact={
        user.trustedContactName
          ? { name: user.trustedContactName, phone: user.trustedContactPhone }
          : null
      }
    />
  );
}
