import { NextResponse, type NextRequest } from 'next/server';
import { writeAudit } from '@/lib/audit';
import { livekitConfigured, livekitUrl, mintRoomToken, sessionRoomNameFor } from '@/lib/livekit';
import { verifySessionVideoSig } from '@/lib/session-video-links';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * VS1 — POST /api/v1/public/sessions/[id]/video-token?sig=…
 *
 * The client's side of a session video room, reached from the signed link
 * the therapist shared (WhatsApp / copy). No auth session: the signature IS
 * the credential, exactly like the appointment join links. Tokens carry no
 * client identity (identity "patient", display "Client") — DPDP posture
 * matches the appointment rooms.
 *
 * A leaked link is bounded by session state: minting refuses unless the
 * session is SCHEDULED or IN_PROGRESS, so the link dies the moment the
 * therapist ends the session.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: sessionId } = await params;
  const sig = new URL(req.url).searchParams.get('sig') ?? '';
  if (!verifySessionVideoSig(sessionId, sig)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }
  if (!livekitConfigured()) {
    return NextResponse.json(
      { error: 'Video is not available right now — ask your therapist for another way to join.' },
      { status: 503 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, psychologistId: true },
  });
  if (!session || (session.status !== 'SCHEDULED' && session.status !== 'IN_PROGRESS')) {
    return NextResponse.json(
      { error: 'This session is not open. Ask your therapist for a fresh link.' },
      { status: 409 },
    );
  }

  const token = await mintRoomToken(sessionRoomNameFor(sessionId), 'patient', 'Client');

  // The signed-link join is part of the session's clinical record: it shows
  // the client entered the recorded room after seeing the recording notice
  // on the join page.
  await writeAudit({
    actorType: 'CLIENT',
    actorPsychologistId: session.psychologistId,
    action: 'VIDEO_SESSION_CLIENT_JOINED',
    targetType: 'Session',
    targetId: sessionId,
    metadata: { via: 'signed-link' },
  });

  return NextResponse.json({ token, url: livekitUrl() });
}
