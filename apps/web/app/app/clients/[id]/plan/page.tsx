import { notFound, redirect } from 'next/navigation';
import { ClientPlanOfCareContent } from '@/components/app/PlanOfCareTab';
import { ClientWorkspacePage } from '@/components/app/ClientWorkspacePage';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientPlanPage({ params }: PageProps) {
  const { id } = await params;
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
  });
  if (!client) notFound();
  const pii = await resolveClientPii(client);

  return (
    <ClientWorkspacePage
      clientId={client.id}
      clientName={pii.fullName}
      eyebrow="Longitudinal care"
      title="Plan of care"
      description="The active treatment direction, goals, formulation, and progress remain attached to the client across sessions."
    >
      <ClientPlanOfCareContent
        sessionId={null}
        clientId={client.id}
        psychologistId={therapist.id}
        clientName={pii.fullName}
        clientHasContactPhone={!!pii.contactPhone}
        clientHasContactEmail={!!pii.contactEmail}
        preferredLanguage={client.preferredLanguage}
      />
    </ClientWorkspacePage>
  );
}
