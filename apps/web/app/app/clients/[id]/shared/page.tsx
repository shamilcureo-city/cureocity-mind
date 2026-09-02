import { notFound, redirect } from 'next/navigation';
import { ClientWorkspacePage } from '@/components/app/ClientWorkspacePage';
import { ShareReceiptList } from '@/components/app/ShareReceiptList';
import { ClientCareAccessPanel } from '@/components/app/ClientCareAccessPanel';
import { Card } from '@/components/ui/Card';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { getEffectiveCapabilities } from '@/lib/capabilities';
import { resolveClientPii } from '@/lib/client-pii';

import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientSharedPage({ params }: PageProps) {
  const { id } = await params;
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const effective = await getEffectiveCapabilities(therapist.id);
  if (!effective.capabilities.has('PATIENT_SHARING')) notFound();
  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
  });
  if (!client) notFound();
  const [pii, shares] = await Promise.all([
    resolveClientPii(client),
    prisma.patientShare.findMany({
      where: { clientId: client.id, psychologistId: therapist.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        artefactType: true,
        channel: true,
        status: true,
        sentAt: true,
        openedAt: true,
        revokedAt: true,
        errorCode: true,
        verifiedNonDeliveryAt: true,
        expiresAt: true,
        refreshRequestedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <ClientWorkspacePage
      clientId={client.id}
      clientName={pii.fullName}
      eyebrow="Longitudinal care"
      title="Shared with client"
      description="A durable record of what left the clinical workspace and whether the client received or opened it."
    >
      <ClientCareAccessPanel clientId={client.id} />
      <Card className="overflow-hidden">
        {shares.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-3)]">
            Nothing has been shared with this client yet.
          </p>
        ) : (
          <ShareReceiptList
            receipts={shares.map((share) => ({
              ...share,
              createdAt: share.createdAt.toISOString(),
              sentAt: share.sentAt?.toISOString() ?? null,
              openedAt: share.openedAt?.toISOString() ?? null,
              revokedAt: share.revokedAt?.toISOString() ?? null,
              verifiedNonDeliveryAt: share.verifiedNonDeliveryAt?.toISOString() ?? null,
              expiresAt: share.expiresAt.toISOString(),
              refreshRequestedAt: share.refreshRequestedAt?.toISOString() ?? null,
            }))}
          />
        )}
      </Card>
    </ClientWorkspacePage>
  );
}
