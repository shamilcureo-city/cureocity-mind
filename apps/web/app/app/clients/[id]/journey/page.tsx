import { notFound, redirect } from 'next/navigation';
import { ClientJourneyContent } from '@/components/app/AICopilotTab';
import { ClientWorkspacePage } from '@/components/app/ClientWorkspacePage';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientJourneyPage({ params }: PageProps) {
  const { id } = await params;
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
    include: {
      sessions: {
        where: { status: 'COMPLETED' },
        orderBy: [
          { endedAt: { sort: 'desc', nulls: 'last' } },
          { scheduledAt: 'desc' },
          { id: 'desc' },
        ],
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!client) notFound();
  const pii = await resolveClientPii(client);

  return (
    <ClientWorkspacePage
      clientId={client.id}
      clientName={pii.fullName}
      eyebrow="Longitudinal care"
      title="Journey & outcomes"
      description="Stage, outcome measures, the story so far, and next-session direction belong to this client record—not to one historical session."
    >
      <ClientJourneyContent
        sessionId={client.sessions[0]?.id ?? null}
        clientId={client.id}
        psychologistId={therapist.id}
        clientName={pii.fullName}
        clientHasContactPhone={!!pii.contactPhone}
        clientHasContactEmail={!!pii.contactEmail}
      />
    </ClientWorkspacePage>
  );
}
