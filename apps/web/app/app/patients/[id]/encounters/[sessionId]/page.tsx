import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { Badge } from '@/components/ui/Badge';
import { DoctorEncounterPanel } from '@/components/app/DoctorEncounterPanel';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV3 — the doctor encounter workspace. Record → medical note on
 * the existing batch pipeline (DoctorEncounterPanel drives the loop).
 * Doctor-guarded + ownership-checked; isolated from the therapy session
 * workspace. See docs/DOCTOR_VERTICAL.md.
 */
export default async function EncounterWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  const { id: clientId, sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      psychologistId: true,
      clientId: true,
      client: { select: { fullName: true, fullNameEncrypted: true } },
    },
  });
  if (!session || session.psychologistId !== doctor.id || session.clientId !== clientId) {
    notFound();
  }
  const clientFullName = await decryptClientField(
    session.psychologistId,
    session.client.fullNameEncrypted,
    session.client.fullName,
  );

  return (
    <Container className="py-10">
      <Link
        href={`/app/patients/${clientId}`}
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← {clientFullName}
      </Link>
      <header className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Encounter</h1>
        <div className="flex items-center gap-3">
          <Link
            href={`/app/patients/${clientId}/encounters/${sessionId}/live`}
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            ⚡ Try the live copilot (preview)
          </Link>
          <Badge tone={session.status === 'COMPLETED' ? 'accent' : 'muted'}>
            {session.status.toLowerCase()}
          </Badge>
        </div>
      </header>
      <DoctorEncounterPanel
        sessionId={session.id}
        clientId={clientId}
        clientName={clientFullName}
        sessionStatus={session.status}
      />
    </Container>
  );
}
