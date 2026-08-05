import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { livekitConfigured, livekitUrl, mintRoomToken, sessionRoomNameFor } from '@/lib/livekit';
import { sessionJoinUrl } from '@/lib/session-video-links';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * VS1 — the therapist's side of a SESSION video room (the Record screen's
 * "Virtual" option; ad-hoc, no appointment needed).
 *
 * POST mints the LiveKit token for the session's room and returns it with
 * the signed client join link, so the virtual surface can offer Copy /
 * WhatsApp the moment it loads. Tenant-checked; refuses once the session is
 * over (a stale tab can't reopen a finished session's room).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  if (!livekitConfigured()) {
    return NextResponse.json(
      { error: 'In-app video is not configured on this deployment.' },
      { status: 503 },
    );
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      psychologistId: true,
      status: true,
      psychologist: { select: { fullName: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
    return NextResponse.json(
      { error: `This session is ${session.status.toLowerCase()} — the room is closed.` },
      { status: 409 },
    );
  }

  const token = await mintRoomToken(
    sessionRoomNameFor(sessionId),
    'therapist',
    session.psychologist.fullName ?? 'Therapist',
  );
  return NextResponse.json({
    token,
    url: livekitUrl(),
    joinUrl: sessionJoinUrl(sessionId),
  });
}
