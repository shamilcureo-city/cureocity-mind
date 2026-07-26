import { NoopBackend, SendGridBackend } from '@cureocity/notifications';
import type { IEmailPort } from '@cureocity/notifications';
import { prisma } from '@/lib/prisma';
import { decryptForTenant } from '@/lib/tenant-crypto';
import { publicBaseUrl, signAppointmentId } from '@/lib/appointment-links';

/**
 * Marketing V1 — "new appointment request" nudge to the therapist.
 * Same transport pattern as welcome-email.ts (SendGrid from env, Noop
 * in dev/CI). Deliberately contains NO patient details — the therapist
 * reads the request inside the app, so patient PII never rides email.
 */

declare global {
  var __cureocityAppointmentEmail: IEmailPort | undefined;
}

function client(): IEmailPort {
  if (globalThis.__cureocityAppointmentEmail) return globalThis.__cureocityAppointmentEmail;
  const apiKey = process.env['SENDGRID_API_KEY'];
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'];
  const fromName = process.env['SENDGRID_FROM_NAME'] ?? 'Cureocity Mind';
  const port: IEmailPort =
    apiKey && fromEmail ? new SendGridBackend({ apiKey, fromEmail, fromName }) : new NoopBackend();
  globalThis.__cureocityAppointmentEmail = port;
  return port;
}

const IST_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export async function sendAppointmentRequestEmail(
  psychologistId: string,
  startAt: Date,
): Promise<void> {
  try {
    const psy = await prisma.psychologist.findUnique({
      where: { id: psychologistId },
      select: { email: true, fullName: true },
    });
    if (!psy) return;
    const when = IST_FORMAT.format(startAt);
    await client().sendEmail({
      to: psy.email,
      subject: `New appointment request — ${when}`,
      textBody: `Hi ${psy.fullName},

Someone requested an appointment with you for ${when} (IST) through your
public Cureocity page. The slot is held for them until you respond.

Review and confirm or decline it here:
${process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://mind.cureocity.in'}/app/marketing

— Cureocity Mind`,
    });
  } catch (e) {
    // Notification-only path: log, never break the request that queued it.
    console.warn(`[appointment-email] send failed: ${(e as Error).message}`);
  }
}

/**
 * MK4 — patient confirmation on therapist-confirm. Includes the signed
 * calendar (.ics) and cancel links; no clinical content.
 */
export async function sendAppointmentConfirmedEmail(
  patientEmail: string,
  therapistName: string,
  appointmentId: string,
  startAt: Date,
): Promise<void> {
  try {
    const sig = signAppointmentId(appointmentId);
    const base = publicBaseUrl();
    const when = IST_FORMAT.format(startAt);
    await client().sendEmail({
      to: patientEmail,
      subject: `Confirmed — your session on ${when}`,
      textBody: `Your appointment with ${therapistName} is confirmed for ${when} (IST).

Add it to your calendar:
${base}/api/v1/public/appointments/${appointmentId}/calendar?sig=${sig}

Can't make it? Cancel here so the time opens up for someone else:
${base}/p/appointments/${appointmentId}/cancel?sig=${sig}

— Cureocity`,
    });
  } catch (e) {
    console.warn(`[appointment-email] confirm send failed: ${(e as Error).message}`);
  }
}

/**
 * MK4 — reminders (24h / 2h). Therapist always; patient too when they
 * left an email. WhatsApp joins when WATI is procured (ops backlog).
 */
export async function sendAppointmentReminderEmails(
  psychologistId: string,
  appointmentId: string,
  startAt: Date,
  windowHours: number,
): Promise<void> {
  try {
    const [psy, appt] = await Promise.all([
      prisma.psychologist.findUnique({
        where: { id: psychologistId },
        select: { email: true, fullName: true },
      }),
      prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { patientEmailEncrypted: true },
      }),
    ]);
    const when = IST_FORMAT.format(startAt);
    const sends: Promise<unknown>[] = [];
    if (psy) {
      sends.push(
        client().sendEmail({
          to: psy.email,
          subject: `Reminder — session at ${when}`,
          textBody: `Hi ${psy.fullName},

You have a booked session at ${when} (IST), about ${windowHours} hours from now.
Details: ${publicBaseUrl()}/app/marketing

— Cureocity Mind`,
        }),
      );
    }
    if (appt?.patientEmailEncrypted && psy) {
      const patientEmail = await decryptForTenant(psychologistId, appt.patientEmailEncrypted);
      if (patientEmail) {
        const sig = signAppointmentId(appointmentId);
        sends.push(
          client().sendEmail({
            to: patientEmail,
            subject: `Reminder — your session at ${when}`,
            textBody: `Your session with ${psy.fullName} is at ${when} (IST).

Can't make it? Cancel here so the time opens up for someone else:
${publicBaseUrl()}/p/appointments/${appointmentId}/cancel?sig=${sig}

— Cureocity`,
          }),
        );
      }
    }
    await Promise.all(sends);
  } catch (e) {
    console.warn(`[appointment-email] reminder send failed: ${(e as Error).message}`);
  }
}
