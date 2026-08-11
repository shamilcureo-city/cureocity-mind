import { NextResponse, type NextRequest } from 'next/server';
import type { Appointment, ListAppointmentsResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { publicBaseUrl, signAppointmentId } from '@/lib/appointment-links';
import { livekitConfigured } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';
import { decryptForTenant } from '@/lib/tenant-crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/appointments — the therapist's appointment inbox.
 * Tenant-filtered; PII decrypted server-side for the owner only.
 * Upcoming + recent (last 30 days), newest request first.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psyId = auth.value.psychologistId;

  const rows = await prisma.appointment.findMany({
    where: {
      psychologistId: psyId,
      startAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
    },
    orderBy: [{ status: 'asc' }, { startAt: 'asc' }],
    take: 100,
  });

  const items: Appointment[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      status: r.status,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      mode: r.mode === 'IN_PERSON' ? ('IN_PERSON' as const) : ('ONLINE' as const),
      patientName: (await decryptForTenant(psyId, r.patientNameEncrypted)) ?? '(unreadable)',
      patientPhone: (await decryptForTenant(psyId, r.patientPhoneEncrypted)) ?? '(unreadable)',
      patientEmail: r.patientEmailEncrypted
        ? await decryptForTenant(psyId, r.patientEmailEncrypted)
        : null,
      concern: r.concernEncrypted ? await decryptForTenant(psyId, r.concernEncrypted) : null,
      clientId: r.clientId,
      sessionId: r.sessionId,
      createdAt: r.createdAt.toISOString(),
      // The patient's signed join link, so a phone-only booking (email is
      // optional) can still be texted its way into the video room.
      patientJoinUrl:
        r.mode !== 'IN_PERSON' && r.status === 'CONFIRMED' && livekitConfigured()
          ? `${publicBaseUrl()}/p/appointments/${r.id}/join?sig=${signAppointmentId(r.id)}`
          : null,
    })),
  );

  const body: ListAppointmentsResponse = { items };
  return NextResponse.json(body);
}
