import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { getEffectiveCapabilities } from '@/lib/capabilities';
import { decryptClientField } from '@/lib/client-pii';
import { isScribeTeleconsultEnabled } from '@/lib/scribe-teleconsult-links';
import { prisma } from '@/lib/prisma';
import { ScribeTeleconsultShell } from '@/components/app/ScribeTeleconsultShell';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Video consultation · Cureocity Scribe',
  robots: { index: false, follow: false },
};

export default async function ScribeTeleconsultPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const doctor = await requireOnboardedDoctor();
  if (!isScribeTeleconsultEnabled()) notFound();
  if (doctor.status !== 'ACTIVE' || doctor.deletedAt !== null) notFound();
  // Server-rendered patient details are a disclosure too. Recheck current authority
  // before querying or decrypting them; the client API guard runs only afterwards.
  const authority = await getEffectiveCapabilities(doctor.id).catch(() => null);
  if (
    !authority?.capabilities.has('MEDICAL_DOCUMENTATION') ||
    !authority.capabilities.has('LIVE_ENCOUNTER')
  )
    notFound();
  const { id: clientId, sessionId } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      clientId,
      psychologistId: doctor.id,
      client: { deletedAt: null, status: 'ACTIVE', psychologistId: doctor.id },
    },
    select: { status: true, client: { select: { fullNameEncrypted: true, dateOfBirth: true } } },
  });
  if (!session) notFound();
  const name = await decryptClientField(doctor.id, session.client.fullNameEncrypted);
  const dob = session.client.dateOfBirth;
  const today = new Date();
  let age = dob
    ? today.getFullYear() -
      dob.getFullYear() -
      Number(
        today.getMonth() < dob.getMonth() ||
          (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate()),
      )
    : null;
  if (age !== null && (age < 0 || age >= 150)) age = null;
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <Link
        href={`/app/patients/${clientId}/encounters/${sessionId}`}
        className="text-sm text-[var(--color-ink-2)] hover:underline"
      >
        Back to encounter
      </Link>
      <header className="my-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Video consultation</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            {name}
            {age !== null ? ` · ${age}` : ''}
            {doctor.specialty ? ` · ${doctor.specialty}` : ''}
          </p>
        </div>
        <p className="text-sm text-[var(--color-ink-2)]">Cureocity Scribe</p>
      </header>
      {!['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(session.status) ? (
        <p role="status" className="rounded-xl border border-[var(--color-line)] bg-white p-6">
          This encounter is no longer open for video capture. Open the encounter to review its
          clinical record.
        </p>
      ) : (
        <ScribeTeleconsultShell
          key={sessionId}
          sessionId={sessionId}
          clientId={clientId}
          patient={{ name, age }}
          specialty={doctor.specialty}
          sessionClosed={session.status === 'COMPLETED'}
        />
      )}
    </main>
  );
}
