import { NextResponse, type NextRequest } from 'next/server';
import type { ConfirmAppointmentResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';
import { after } from 'next/server';
import { sendAppointmentConfirmedEmail } from '@/lib/appointment-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/appointments/[id]/confirm
 *
 * The loop that makes marketing feed scribe: a REQUESTED public
 * appointment becomes a real Client + a SCHEDULED INTAKE Session at
 * the held slot, and the therapist lands in the normal intake flow
 * (pre-flight consent capture happens at session start, as always).
 *
 * The Client is minted with the appointment's encrypted PII. The
 * booking's ciphertext was encrypted under this tenant's DEK already,
 * but we re-encrypt from plaintext so the Client row gets its own
 * fresh envelopes (same posture as the create-client route).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const psyId = auth.value.psychologistId;
  const { id } = await params;

  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt || appt.psychologistId !== psyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (appt.status !== 'REQUESTED') {
    return NextResponse.json({ error: `Already ${appt.status.toLowerCase()}.` }, { status: 409 });
  }

  const [name, phone, email, concern] = await Promise.all([
    decryptForTenant(psyId, appt.patientNameEncrypted),
    decryptForTenant(psyId, appt.patientPhoneEncrypted),
    appt.patientEmailEncrypted ? decryptForTenant(psyId, appt.patientEmailEncrypted) : null,
    appt.concernEncrypted ? decryptForTenant(psyId, appt.concernEncrypted) : null,
  ]);
  if (!name || !phone) {
    return NextResponse.json(
      { error: 'Appointment PII cannot be decrypted — cannot mint a client from it.' },
      { status: 422 },
    );
  }

  const psy = await prisma.psychologist.findUnique({
    where: { id: psyId },
    select: { defaultOutputLanguage: true },
  });

  const [fullNameEncrypted, contactPhoneEncrypted, contactEmailEncrypted] = await Promise.all([
    encryptForTenant(psyId, name),
    encryptForTenant(psyId, phone),
    email ? encryptForTenant(psyId, email) : null,
  ]);

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        psychologistId: psyId,
        fullNameEncrypted,
        contactPhoneEncrypted,
        contactEmailEncrypted,
        ...(concern && { presentingConcerns: concern }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psyId,
        action: 'CLIENT_CREATED',
        targetType: 'Client',
        targetId: client.id,
        metadata: { source: 'public-appointment', appointmentId: appt.id },
      },
      tx,
    );

    // A first-contact client: the session is an INTAKE by definition.
    const session = await tx.session.create({
      data: {
        clientId: client.id,
        psychologistId: psyId,
        kind: 'INTAKE',
        modality: 'INTAKE',
        status: 'SCHEDULED',
        scheduledAt: appt.startAt,
        language: psy?.defaultOutputLanguage ?? 'en',
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psyId,
        action: 'SESSION_CREATED',
        targetType: 'Session',
        targetId: session.id,
        metadata: { clientId: client.id, source: 'public-appointment', kind: 'INTAKE' },
      },
      tx,
    );

    const episode = await tx.treatmentEpisode.create({
      data: { clientId: client.id, psychologistId: psyId, status: 'OPEN' },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'TREATMENT_EPISODE_OPENED',
        targetType: 'TreatmentEpisode',
        targetId: episode.id,
        metadata: { clientId: client.id, sessionId: session.id },
      },
      tx,
    );

    await tx.appointment.update({
      where: { id: appt.id },
      data: { status: 'CONFIRMED', clientId: client.id, sessionId: session.id },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psyId,
        action: 'APPOINTMENT_CONFIRMED',
        targetType: 'Appointment',
        targetId: appt.id,
        metadata: { clientId: client.id, sessionId: session.id },
      },
      tx,
    );
    return { clientId: client.id, sessionId: session.id };
  });

  if (email) {
    const psyName = await prisma.psychologist.findUnique({
      where: { id: psyId },
      select: { fullName: true },
    });
    after(() =>
      sendAppointmentConfirmedEmail(
        psyId,
        email,
        psyName?.fullName ?? 'your therapist',
        appt.id,
        appt.startAt,
      ),
    );
  }

  const body: ConfirmAppointmentResponse = result;
  return NextResponse.json(body);
}
