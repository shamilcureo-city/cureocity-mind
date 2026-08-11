import { NextResponse, type NextRequest } from 'next/server';
import type { ConfirmAppointmentResponse } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';
import { after } from 'next/server';
import { sendAppointmentConfirmedEmail } from '@/lib/appointment-email';
import { computeSessionDefaults } from '@/lib/session-defaults';
import { toNationalDigits } from '@/lib/phone';

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

  // A RETURNING client often books through the public page. Minting a new
  // Client every time split their history in two (duplicate roster row, a
  // second open episode, an intake-shaped note for what is really a
  // continuation). Phone is the booking's identity anchor: an exact match
  // against the existing roster links the appointment to that client
  // instead. Phones are envelope-encrypted (non-deterministic), so this is
  // a decrypt-and-compare sweep — fine at practice scale.
  const bookedDigits = toNationalDigits(phone);
  let matchedClientId: string | null = null;
  if (bookedDigits.length === 10) {
    const roster = await prisma.client.findMany({
      where: { psychologistId: psyId, deletedAt: null, isDemo: false },
      select: { id: true, contactPhoneEncrypted: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const c of roster) {
      if (!c.contactPhoneEncrypted) continue;
      const p = await decryptForTenant(psyId, c.contactPhoneEncrypted);
      if (p && toNationalDigits(p) === bookedDigits) {
        matchedClientId = c.id;
        break;
      }
    }
  }
  // For a matched client the session kind/modality come from the same
  // server-side inference every other session-create path uses — a
  // returning client gets a TREATMENT/REVIEW continuation, not a forced
  // re-intake.
  const matchedDefaults = matchedClientId
    ? await computeSessionDefaults(matchedClientId, psyId)
    : null;

  const [fullNameEncrypted, contactPhoneEncrypted, contactEmailEncrypted] = await Promise.all([
    encryptForTenant(psyId, name),
    encryptForTenant(psyId, phone),
    email ? encryptForTenant(psyId, email) : null,
  ]);

  const result = await prisma.$transaction(async (tx) => {
    let clientId: string;
    if (matchedClientId) {
      clientId = matchedClientId;
    } else {
      const client = await tx.client.create({
        data: {
          psychologistId: psyId,
          fullNameEncrypted,
          contactPhoneEncrypted,
          contactEmailEncrypted,
          ...(concern && { presentingConcerns: concern }),
        },
      });
      clientId = client.id;
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
    }

    const session = await tx.session.create({
      data: {
        clientId,
        psychologistId: psyId,
        // New client: an INTAKE by definition. Matched client: whatever the
        // cumulative state says comes next.
        kind: matchedDefaults?.kind ?? 'INTAKE',
        modality: matchedDefaults ? matchedDefaults.modality : 'INTAKE',
        status: 'SCHEDULED',
        scheduledAt: appt.startAt,
        language: matchedDefaults?.language ?? psy?.defaultOutputLanguage ?? 'en',
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psyId,
        action: 'SESSION_CREATED',
        targetType: 'Session',
        targetId: session.id,
        metadata: {
          clientId,
          source: 'public-appointment',
          kind: matchedDefaults?.kind ?? 'INTAKE',
          ...(matchedClientId && { matchedExistingClient: true }),
        },
      },
      tx,
    );

    // Open an episode only when the client doesn't already have one open —
    // a returning client's booking must not stack a second OPEN episode.
    const openEpisode = matchedClientId
      ? await tx.treatmentEpisode.findFirst({
          where: { clientId, psychologistId: psyId, status: 'OPEN' },
          select: { id: true },
        })
      : null;
    if (!openEpisode) {
      const episode = await tx.treatmentEpisode.create({
        data: { clientId, psychologistId: psyId, status: 'OPEN' },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'TREATMENT_EPISODE_OPENED',
          targetType: 'TreatmentEpisode',
          targetId: episode.id,
          metadata: { clientId, sessionId: session.id },
        },
        tx,
      );
    }

    await tx.appointment.update({
      where: { id: appt.id },
      data: { status: 'CONFIRMED', clientId, sessionId: session.id },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: psyId,
        action: 'APPOINTMENT_CONFIRMED',
        targetType: 'Appointment',
        targetId: appt.id,
        metadata: {
          clientId,
          sessionId: session.id,
          ...(matchedClientId && { matchedExistingClient: true }),
        },
      },
      tx,
    );
    return { clientId, sessionId: session.id };
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
