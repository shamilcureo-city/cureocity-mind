import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveEncounterFlow } from '@/components/app/LiveEncounterFlow';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint DV4 — the live copilot. Doctor-guarded + ownership checked; the
 * live UX itself is driven by the standalone WebSocket gateway, which runs
 * the real pipeline (Pass 1 transcription + Pass 2 medical note + gap
 * engine) on streamed mic audio. See services/live-gateway +
 * docs/DOCTOR_VERTICAL.md §4.
 *
 * Sprint DS7 — arriving from the clinic queue with `?flash=1` plays the
 * 3-second context flash first, then auto-starts the mic (zero-click flow).
 */
export default async function LiveEncounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ flash?: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  const { id: clientId, sessionId } = await params;
  const { flash } = await searchParams;
  const showFlash = flash === '1';

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      client: {
        select: { fullNameEncrypted: true, dateOfBirth: true },
      },
    },
  });
  if (!session || session.psychologistId !== doctor.id || session.clientId !== clientId) {
    notFound();
  }

  const name = await decryptClientField(session.psychologistId, session.client.fullNameEncrypted);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <Link
        href={`/app/patients/${clientId}/encounters/${sessionId}`}
        className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        ← Encounter
      </Link>
      <div className="mb-4 mt-3 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Live copilot
        </p>
        <span className="text-xs text-[var(--color-ink-3)]">
          · transcript + note build in real time · audio is streamed, not stored
        </span>
      </div>

      <LiveEncounterFlow
        sessionId={sessionId}
        clientId={clientId}
        specialty={doctor.specialty}
        patient={{ name, age: ageFrom(session.client.dateOfBirth) }}
        showFlash={showFlash}
      />
    </div>
  );
}

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}
