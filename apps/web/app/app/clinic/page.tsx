import { ClinicBoard } from '@/components/app/ClinicBoard';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { loadClinicQueue } from '@/lib/clinic-queue';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { ScribePendingWorkPanel } from '@/components/app/ScribePendingWorkPanel';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * Sprint DS7 — the doctor's landing page: today's OPD queue (the zero-click
 * clinic flow). Doctor-guarded; the queue itself is built by the shared
 * lib/clinic-queue reader so this page and GET /clinic/queue never drift.
 * See docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */
export default async function ClinicPage() {
  const doctor = await requireOnboardedDoctor();

  const [queue, rawPatients] = await Promise.all([
    loadClinicQueue(doctor.id),
    prisma.client.findMany({
      where: { psychologistId: doctor.id, deletedAt: null, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, fullNameEncrypted: true },
    }),
  ]);

  const patients = await Promise.all(
    rawPatients.map(async (c) => ({
      id: c.id,
      name: await decryptClientField(doctor.id, c.fullNameEncrypted),
    })),
  );

  return (
    <>
      <ClinicBoard queue={queue} patients={patients} />
      <div className="mx-auto max-w-6xl px-6">
        <Link
          href="/app/clinic/templates"
          className="my-3 inline-flex min-h-11 items-center rounded-lg border border-[var(--color-line)] bg-white px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          My note and document templates
        </Link>
        <ScribePendingWorkPanel patients={patients} />
      </div>
    </>
  );
}
