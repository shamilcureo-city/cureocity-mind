import { ClinicBoard } from '@/components/app/ClinicBoard';
import { requireOnboardedDoctor } from '@/lib/auth-page';
import { loadClinicQueue } from '@/lib/clinic-queue';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

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
      select: { id: true, fullName: true, fullNameEncrypted: true },
    }),
  ]);

  const patients = await Promise.all(
    rawPatients.map(async (c) => ({
      id: c.id,
      name: await decryptClientField(doctor.id, c.fullNameEncrypted, c.fullName),
    })),
  );

  return <ClinicBoard queue={queue} patients={patients} />;
}
