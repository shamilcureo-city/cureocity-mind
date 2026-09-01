import { notFound, redirect } from 'next/navigation';
import { ClientWorkspacePage } from '@/components/app/ClientWorkspacePage';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { resolveClientPii } from '@/lib/client-pii';
import { formatIstDateTime } from '@/lib/ist';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientSharedPage({ params }: PageProps) {
  const { id } = await params;
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
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
      <Card className="overflow-hidden">
        {shares.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-3)]">
            Nothing has been shared with this client yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {shares.map((share) => (
              <li key={share.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{share.subject}</p>
                    <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                      {share.artefactType.replace(/_/g, ' ').toLowerCase()} ·{' '}
                      {share.channel.toLowerCase()} ·{' '}
                      {formatIstDateTime(share.sentAt ?? share.createdAt)}
                    </p>
                    {share.openedAt && (
                      <p className="mt-1 text-xs text-[var(--color-ink-2)]">
                        Opened {formatIstDateTime(share.openedAt)}
                      </p>
                    )}
                  </div>
                  <Badge
                    tone={
                      share.revokedAt
                        ? 'muted'
                        : share.status.endsWith('FAILURE')
                          ? 'warn'
                          : 'accent'
                    }
                  >
                    {share.revokedAt ? 'revoked' : share.status.toLowerCase()}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ClientWorkspacePage>
  );
}
