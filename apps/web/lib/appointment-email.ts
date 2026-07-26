import { NoopBackend, SendGridBackend } from '@cureocity/notifications';
import type { IEmailPort } from '@cureocity/notifications';
import { prisma } from '@/lib/prisma';

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
