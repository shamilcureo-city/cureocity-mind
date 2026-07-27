import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signAppointmentId, verifyAppointmentSig } from '@/lib/appointment-links';
import { livekitConfigured } from '@/lib/livekit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/public/appointments/[id]/calendar?sig=…
 *
 * PUBLIC, signed — a .ics file for the appointment. Contains only the
 * time and the therapist's public name (never patient details), so the
 * calendar entry is safe on a shared device.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get('sig') ?? '';
  if (!verifyAppointmentSig(id, sig)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { startAt: true, endAt: true, status: true, psychologistId: true, mode: true },
  });
  if (!appt || appt.status === 'CANCELLED' || appt.status === 'DECLINED') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const psy = await prisma.psychologist.findUnique({
    where: { id: appt.psychologistId },
    select: { fullName: true, publicSlug: true, videoCallLink: true, officeAddress: true },
  });
  // MK8/MK9 — where the session happens: the in-app room when LiveKit
  // is configured, else the therapist's own meeting link; clinic
  // address for in-person. Commas/semicolons escaped per RFC 5545.
  const joinUrl = livekitConfigured()
    ? `https://mind.cureocity.in/p/appointments/${id}/join?sig=${signAppointmentId(id)}`
    : (psy?.videoCallLink ?? null);
  const location =
    appt.mode === 'IN_PERSON' ? psy?.officeAddress?.replace(/([,;])/g, '\\$1') : joinUrl;

  const stamp = (d: Date): string =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cureocity//Appointments//EN',
    'BEGIN:VEVENT',
    `UID:${id}@cureocity.in`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(appt.startAt)}`,
    `DTEND:${stamp(appt.endAt)}`,
    `SUMMARY:Therapy session — ${psy?.fullName ?? 'Cureocity'}`,
    ...(location ? [`LOCATION:${location}`] : []),
    ...(appt.mode !== 'IN_PERSON' && joinUrl
      ? [`URL:${joinUrl}`]
      : psy?.publicSlug
        ? [`URL:https://mind.cureocity.in/therapists/${psy.publicSlug}`]
        : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="appointment.ics"',
    },
  });
}
