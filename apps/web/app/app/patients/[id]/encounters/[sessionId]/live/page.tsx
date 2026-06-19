import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { DoctorLiveEncounter } from '@/components/app/DoctorLiveEncounter';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV4 — the live copilot preview. Doctor-guarded + ownership
 * checked; the live UX itself is driven by the standalone WebSocket
 * gateway (mock). See services/live-gateway + docs/DOCTOR_VERTICAL.md §4.
 */
export default async function LiveEncounterPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  const { id: clientId, sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, psychologistId: true, clientId: true },
  });
  if (!session || session.psychologistId !== doctor.id || session.clientId !== clientId) {
    notFound();
  }

  return (
    <Container className="py-10">
      <Link
        href={`/app/patients/${clientId}/encounters/${sessionId}`}
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Encounter
      </Link>
      <header className="mb-6 mt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Live copilot · preview
        </p>
        <h1 className="mt-2 font-serif text-3xl">The note writes itself, while you consult.</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          A preview of the live path: the note builds in real time and red flags surface
          mid-consult. Driven by the mock gateway (no audio yet) — the real streaming ASR +
          structurer are the next step.
        </p>
      </header>
      <DoctorLiveEncounter />
    </Container>
  );
}
