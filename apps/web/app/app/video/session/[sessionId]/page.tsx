import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOnboardedTherapist } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { Container } from '@/components/ui/Container';
import { VirtualSessionShell } from '@/components/app/VirtualSessionShell';

export const dynamic = 'force-dynamic';

/**
 * VS1 — the therapist's VIRTUAL session surface: LiveKit room + client link
 * + the scribe recorder, one page. Reached from the Record screen's Virtual
 * option. Lives under /app/video/* so the existing Permissions-Policy
 * carve-out (camera/mic self) covers it. Tenant-checked here; the token
 * routes re-check everything.
 */
export default async function VirtualSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const therapist = await requireOnboardedTherapist();
  const { sessionId } = await params;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, psychologistId: therapist.id },
    select: {
      id: true,
      clientId: true,
      modality: true,
      status: true,
      client: { select: { fullNameEncrypted: true } },
    },
  });
  if (!session) notFound();
  const clientName = await decryptClientField(therapist.id, session.client.fullNameEncrypted);

  return (
    <Container className="py-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            Virtual session
          </p>
          <h1 className="mt-1 font-serif text-2xl">{clientName}</h1>
        </div>
        <Link
          href={`/app/sessions/${session.id}?tab=copilot`}
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          Open session workspace →
        </Link>
      </div>
      <VirtualSessionShell
        sessionId={session.id}
        clientId={session.clientId}
        clientName={clientName}
        modality={session.modality}
      />
    </Container>
  );
}
