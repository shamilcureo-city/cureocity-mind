import { NoopBackend, SendGridBackend } from '@cureocity/notifications';
import type { IEmailPort } from '@cureocity/notifications';

/**
 * CLIN-1 — immediate therapist alert when a REMOTE self-check-in raises a
 * safety concern (PHQ-9 item 9 endorsed with no clinician in the room).
 *
 * The client already sees crisis resources on the portal; this closes the
 * other half — actively reaching the owning therapist so they don't learn
 * of it only at the next scheduled session.
 *
 * Privacy: the email is deliberately PII-minimal — it names neither the
 * client nor the instrument nor "suicidality" in plaintext (email is an
 * untrusted channel). It says a safety concern was raised and links the
 * therapist into the authenticated app, where the Prepare panel + brief
 * now surface the who + detail. Best-effort + Noop fallback in dev/CI,
 * mirroring welcome-email.ts / share-channels.ts.
 */

declare global {
  var __cureocityCrisisAlertEmail: IEmailPort | undefined;
}

function client(): IEmailPort {
  if (globalThis.__cureocityCrisisAlertEmail) return globalThis.__cureocityCrisisAlertEmail;
  const apiKey = process.env['SENDGRID_API_KEY'];
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'];
  const fromName = process.env['SENDGRID_FROM_NAME'] ?? 'Cureocity Mind';
  const port: IEmailPort =
    apiKey && fromEmail ? new SendGridBackend({ apiKey, fromEmail, fromName }) : new NoopBackend();
  globalThis.__cureocityCrisisAlertEmail = port;
  return port;
}

const SUBJECT = 'Action needed: a client flagged a safety concern';

const TEXT = (name: string, url: string): string =>
  `Hi ${name},

A client just completed a self check-in that raised a safety concern.
Please review and reach out to them as soon as you can.

Open the client's record to see who and the details:
  ${url}

This alert intentionally omits names and specifics — the details are in
your Cureocity Mind account, behind your login.

— Cureocity Mind`;

const HTML = (name: string, url: string): string =>
  `<p>Hi ${escapeHtml(name)},</p>
<p>A client just completed a self check-in that <strong>raised a safety concern</strong>. Please review and reach out to them as soon as you can.</p>
<p><a href="${escapeAttr(url)}">Open the client&rsquo;s record</a> to see who and the details.</p>
<p>This alert intentionally omits names and specifics &mdash; the details are in your Cureocity Mind account, behind your login.</p>
<p>&mdash; Cureocity Mind</p>`;

export interface CrisisAlertResult {
  outcome: 'sent' | 'transient_failure' | 'permanent_failure';
  providerMessageId?: string;
  errorCode?: string;
}

/**
 * Alert a therapist that a client self-check-in raised a safety concern.
 * Never throws — the caller (the public check-in route) must still succeed
 * the client's submission and keep showing them crisis resources even if
 * the alert channel is down.
 */
export async function sendCrisisAlert(opts: {
  to: string;
  therapistName: string;
  clientRecordUrl: string;
}): Promise<CrisisAlertResult> {
  const port = client();
  const res = await port.sendEmail({
    to: opts.to,
    subject: SUBJECT,
    textBody: TEXT(opts.therapistName, opts.clientRecordUrl),
    htmlBody: HTML(opts.therapistName, opts.clientRecordUrl),
  });
  const out: CrisisAlertResult = { outcome: res.outcome };
  if (res.providerMessageId !== undefined) out.providerMessageId = res.providerMessageId;
  if (res.errorCode !== undefined) out.errorCode = res.errorCode;
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
