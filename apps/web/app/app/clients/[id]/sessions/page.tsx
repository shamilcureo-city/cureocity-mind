import Link from 'next/link';
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

export default async function ClientSessionsPage({ params }: PageProps) {
  const { id } = await params;
  const therapist = await requireOnboardedPsychologist();
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  const client = await prisma.client.findFirst({
    where: { id, psychologistId: therapist.id, deletedAt: null },
    include: {
      sessions: {
        orderBy: { scheduledAt: 'desc' },
        select: {
          id: true,
          scheduledAt: true,
          modality: true,
          status: true,
          therapyNote: { select: { id: true } },
          noteDraft: { select: { status: true } },
        },
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
      title="Sessions"
      description="Session-specific notes and transcripts remain attached to their visit while cumulative care stays in the client workspace."
    >
      <Card className="overflow-hidden">
        {client.sessions.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-ink-3)]">No sessions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {client.sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/app/sessions/${session.id}`}
                  className="grid gap-2 px-5 py-4 text-sm hover:bg-[var(--color-surface-soft)] sm:grid-cols-[1.4fr_1fr_1fr_auto]"
                >
                  <span>{formatIstDateTime(session.scheduledAt)}</span>
                  <span className="text-[var(--color-ink-2)]">{session.modality ?? '—'}</span>
                  <span className="text-[var(--color-ink-2)]">
                    {session.therapyNote
                      ? 'Signed note'
                      : session.noteDraft?.status === 'COMPLETED'
                        ? 'Ready to review'
                        : session.noteDraft?.status === 'FAILED'
                          ? 'Needs attention'
                          : '—'}
                  </span>
                  <Badge tone={session.status === 'COMPLETED' ? 'accent' : 'muted'}>
                    {session.status.toLowerCase()}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ClientWorkspacePage>
  );
}
