import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * MK4 — signed public appointment links (cancel + calendar). The
 * signature proves the link came from us without any session: only
 * someone holding the link (the patient, from their confirmation
 * screen/email) can act on the appointment.
 *
 * Key preference: APPOINTMENT_LINK_SECRET, else CRON_SECRET (always set
 * in prod per PRODUCTION_READINESS), else a dev-only constant.
 */

function key(): string {
  return (
    process.env['APPOINTMENT_LINK_SECRET'] ??
    process.env['CRON_SECRET'] ??
    'dev-appointment-link-secret'
  );
}

export function signAppointmentId(appointmentId: string): string {
  return createHmac('sha256', key()).update(appointmentId).digest('hex').slice(0, 32);
}

export function verifyAppointmentSig(appointmentId: string, sig: string): boolean {
  const expected = signAppointmentId(appointmentId);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Absolute base for links that leave the app (emails). */
export function publicBaseUrl(): string {
  return process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://mind.cureocity.in';
}
