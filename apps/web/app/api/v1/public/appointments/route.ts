import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { CreateAppointmentInputSchema, type CreateAppointmentResponse } from '@cureocity/contracts';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { offeredSlot } from '@/lib/marketing';
import { loadBusyIntervals, loadPublishedTherapist, loadWeeklyRules } from '@/lib/public-profile';
import { sendAppointmentRequestEmail } from '@/lib/appointment-email';
import { signAppointmentId } from '@/lib/appointment-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/public/appointments
 *
 * PUBLIC (no auth) — a patient requests a concrete slot from a
 * published profile page. The row is created REQUESTED, which HOLDS
 * the slot (it leaves the public feed immediately); the therapist
 * confirms or declines from /app/marketing.
 *
 * Patient PII is tenant-envelope-encrypted before the row is written —
 * same posture as Client, no plaintext columns.
 *
 * Two racing requests for the same slot: both validate against the
 * freshly-loaded busy set inside the transaction; the serialized
 * re-check makes the second lose with 409.
 */

/** Per-instance best-effort throttle — 5 requests/min/IP. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map<string, number[]>();

function throttled(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (throttled(ip, Date.now())) {
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 });
  }

  const body = await parseJson(req, CreateAppointmentInputSchema);
  if (!body.ok) return body.response;
  const input = body.value;

  const therapist = await loadPublishedTherapist(input.slug);
  if (!therapist) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!therapist.isAcceptingNewClients) {
    return NextResponse.json(
      { error: 'This therapist is not accepting new clients right now.' },
      { status: 409 },
    );
  }

  const startAt = new Date(input.startAt);
  const rules = await loadWeeklyRules(therapist.id);

  // Encrypt before the transaction — KMS I/O doesn't belong inside it.
  const [patientNameEncrypted, patientPhoneEncrypted, patientEmailEncrypted, concernEncrypted] =
    await Promise.all([
      encryptForTenant(therapist.id, input.patientName),
      encryptForTenant(therapist.id, input.patientPhone),
      input.patientEmail ? encryptForTenant(therapist.id, input.patientEmail) : null,
      input.concern ? encryptForTenant(therapist.id, input.concern) : null,
    ]);

  let appointmentId: string;
  try {
    appointmentId = await prisma.$transaction(async (tx) => {
      // Re-derive the offer against CURRENT holds; a racing request that
      // landed first makes this slot un-offered and we bail.
      const now = new Date();
      const to = new Date(now.getTime() + 15 * 24 * 60 * 60_000);
      const busy = await loadBusyIntervals(therapist.id, now, to);
      const slot = offeredSlot(rules, busy, now, startAt);
      if (slot === null) throw new SlotTakenError();

      const row = await tx.appointment.create({
        data: {
          psychologistId: therapist.id,
          startAt,
          endAt: new Date(startAt.getTime() + slot.minutes * 60_000),
          mode: slot.mode ?? 'ONLINE',
          patientNameEncrypted,
          patientPhoneEncrypted,
          patientEmailEncrypted,
          concernEncrypted,
        },
      });
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'APPOINTMENT_REQUESTED',
          targetType: 'Appointment',
          targetId: row.id,
          metadata: { psychologistId: therapist.id, startAt: startAt.toISOString() },
        },
        tx,
      );
      return row.id;
    });
  } catch (e) {
    // SlotTakenError: the re-derived offer says the slot is gone. P2002:
    // the partial unique index on (psychologistId, startAt) caught a race
    // the re-check couldn't see (both requests read before either wrote).
    if (e instanceof SlotTakenError || (e as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'That time was just taken — pick another slot.' },
        { status: 409 },
      );
    }
    throw e;
  }

  // Notify the therapist off the request path.
  after(() => sendAppointmentRequestEmail(therapist.id, startAt));

  const sig = signAppointmentId(appointmentId);
  const res: CreateAppointmentResponse = {
    appointmentId,
    status: 'REQUESTED',
    cancelUrl: `/p/appointments/${appointmentId}/cancel?sig=${sig}`,
    calendarUrl: `/api/v1/public/appointments/${appointmentId}/calendar?sig=${sig}`,
  };
  return NextResponse.json(res, { status: 201 });
}

class SlotTakenError extends Error {
  constructor() {
    super('slot taken');
  }
}
