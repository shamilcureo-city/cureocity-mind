import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAppointmentSig } from '@/lib/appointment-links';
import { livekitConfigured, livekitUrl, mintVideoToken, withinJoinWindow } from '@/lib/livekit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/public/appointments/[id]/video-token?sig=…
 *
 * MK9 — the PATIENT's way into the video room. Signed link (same HMAC
 * as cancel/calendar), CONFIRMED online appointments only, and only
 * inside the join window — a leaked link is useless outside it. The
 * token deliberately carries no patient identity ("Client").
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get('sig') ?? '';
  if (!verifyAppointmentSig(id, sig)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }
  if (!livekitConfigured()) {
    return NextResponse.json(
      { error: 'In-app video is not set up — use the meeting link from your confirmation email.' },
      { status: 503 },
    );
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { status: true, mode: true, startAt: true, endAt: true },
  });
  if (!appt || appt.status !== 'CONFIRMED' || appt.mode === 'IN_PERSON') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!withinJoinWindow(appt.startAt, appt.endAt, new Date())) {
    return NextResponse.json(
      {
        error: 'The room opens 30 minutes before your session.',
        startAt: appt.startAt.toISOString(),
      },
      { status: 425 },
    );
  }

  const token = await mintVideoToken(id, 'patient', 'Client');
  return NextResponse.json({ token, url: livekitUrl() });
}
