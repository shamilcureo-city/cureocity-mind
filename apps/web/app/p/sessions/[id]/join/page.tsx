import { notFound } from 'next/navigation';
import { verifySessionVideoSig } from '@/lib/session-video-links';
import { prisma } from '@/lib/prisma';
import { VideoSessionRoom } from '@/components/video/VideoSessionRoom';

export const dynamic = 'force-dynamic';

/**
 * VS1 — the CLIENT's video room for an ad-hoc virtual session, reached from
 * the signed link the therapist shared from the Record screen. The signature
 * gates the page; the token route re-checks session state and writes the
 * VIDEO_SESSION_CLIENT_JOINED audit row.
 *
 * The recording notice below is part of the consent trail: the client joins
 * AFTER reading that the session is recorded and AI-drafted — the join
 * itself is the audited acknowledgement.
 */
export default async function SessionJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { id } = await params;
  const { sig } = await searchParams;
  if (!sig || !verifySessionVideoSig(id, sig)) notFound();

  const session = await prisma.session.findUnique({
    where: { id },
    select: { psychologistId: true, status: true },
  });
  if (!session) notFound();
  const psy = await prisma.psychologist.findUnique({
    where: { id: session.psychologistId },
    select: { fullName: true },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">
        <VideoSessionRoom
          tokenEndpoint={`/api/v1/public/sessions/${id}/video-token?sig=${encodeURIComponent(sig)}`}
          counterpartLabel={psy?.fullName ?? 'your therapist'}
          leaveHref={`/p/sessions/${id}/join?sig=${encodeURIComponent(sig)}`}
        />
      </div>
      <p className="px-6 py-3 text-center text-xs text-[var(--color-ink-3)]">
        This session is recorded so an AI can draft your therapist&rsquo;s clinical note; your
        therapist reviews everything, and nothing is final without their sign-off. By joining you
        confirm you&rsquo;re okay with that — ask your therapist anything before you join.
      </p>
    </div>
  );
}
