import { notFound } from 'next/navigation';
import { requireOnboardedTherapist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';
import { VideoSessionRoom } from '@/components/video/VideoSessionRoom';

export const dynamic = 'force-dynamic';

/**
 * MK9 — the THERAPIST's video room for an online appointment, reached
 * from the Inquiries tab. Tenant-checked here; the token route
 * re-checks (status, mode, join window).
 */
export default async function TherapistVideoPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const therapist = await requireOnboardedTherapist();
  const { appointmentId } = await params;

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { psychologistId: true },
  });
  if (!appt || appt.psychologistId !== therapist.id) notFound();

  return (
    <VideoSessionRoom
      tokenEndpoint={`/api/v1/appointments/${appointmentId}/video-token`}
      counterpartLabel="your client"
      leaveHref="/app/marketing"
    />
  );
}
