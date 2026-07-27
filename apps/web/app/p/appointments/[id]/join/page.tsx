import { notFound } from 'next/navigation';
import { verifyAppointmentSig } from '@/lib/appointment-links';
import { prisma } from '@/lib/prisma';
import { VideoSessionRoom } from '@/components/video/VideoSessionRoom';

export const dynamic = 'force-dynamic';

/**
 * MK9 — the PATIENT's video room, reached from the signed link in
 * their confirmation/reminder emails. The signature gates the page;
 * the token route re-checks everything (status, mode, join window).
 */
export default async function PatientJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { id } = await params;
  const { sig } = await searchParams;
  if (!sig || !verifyAppointmentSig(id, sig)) notFound();

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { psychologistId: true },
  });
  if (!appt) notFound();
  const psy = await prisma.psychologist.findUnique({
    where: { id: appt.psychologistId },
    select: { fullName: true },
  });

  return (
    <VideoSessionRoom
      tokenEndpoint={`/api/v1/public/appointments/${id}/video-token?sig=${encodeURIComponent(sig)}`}
      counterpartLabel={psy?.fullName ?? 'your therapist'}
      leaveHref={`/p/appointments/${id}/join?sig=${encodeURIComponent(sig)}`}
    />
  );
}
