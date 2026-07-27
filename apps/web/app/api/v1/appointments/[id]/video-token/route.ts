import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { livekitConfigured, livekitUrl, mintVideoToken, withinJoinWindow } from '@/lib/livekit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/appointments/[id]/video-token — MK9, the THERAPIST's way
 * into the video room. Tenant-checked; same join window as the patient.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  if (!livekitConfigured()) {
    return NextResponse.json(
      { error: 'In-app video is not configured — set the LIVEKIT_* env vars.' },
      { status: 503 },
    );
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { psychologistId: true, status: true, mode: true, startAt: true, endAt: true },
  });
  if (!appt || appt.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (appt.status !== 'CONFIRMED' || appt.mode === 'IN_PERSON') {
    return NextResponse.json({ error: 'Not an online confirmed appointment.' }, { status: 409 });
  }
  if (!withinJoinWindow(appt.startAt, appt.endAt, new Date())) {
    return NextResponse.json(
      {
        error: 'The room opens 30 minutes before the session.',
        startAt: appt.startAt.toISOString(),
      },
      { status: 425 },
    );
  }

  const psy = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { fullName: true },
  });
  const token = await mintVideoToken(id, 'therapist', psy?.fullName ?? 'Therapist');
  return NextResponse.json({ token, url: livekitUrl() });
}
