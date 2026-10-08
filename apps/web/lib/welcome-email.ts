import { NoopBackend, SendGridBackend } from '@cureocity/notifications';
import type { IEmailPort } from '@cureocity/notifications';

/**
 * Sprint 31 — transactional welcome email on first onboarding completion.
 *
 * Initialises a SendGrid client from env (same vars as share-channels;
 * Noop fallback in dev/CI so onboarding works without credentials).
 * Module-scoped cache mirrors share-channels.ts so warm function reuse
 * skips re-init.
 *
 * Copy below is intentionally short, warm, and placeholder-safe — swap
 * via `WELCOME_EMAIL_SUBJECT` / `WELCOME_EMAIL_BODY_*` env vars if you
 * want different wording without a code change.
 */

declare global {
  var __cureocityWelcomeEmail: IEmailPort | undefined;
  var __cureocityScribeWelcomeEmail: IEmailPort | undefined;
}

function client(scribe: boolean): IEmailPort {
  const cached = scribe
    ? globalThis.__cureocityScribeWelcomeEmail
    : globalThis.__cureocityWelcomeEmail;
  if (cached) return cached;
  const apiKey = process.env['SENDGRID_API_KEY'];
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'];
  const fromName = scribe
    ? 'Cureocity Scribe'
    : (process.env['SENDGRID_FROM_NAME'] ?? 'Cureocity Mind');
  const port: IEmailPort =
    apiKey && fromEmail ? new SendGridBackend({ apiKey, fromEmail, fromName }) : new NoopBackend();
  if (scribe) globalThis.__cureocityScribeWelcomeEmail = port;
  else globalThis.__cureocityWelcomeEmail = port;
  return port;
}

const DEFAULT_SUBJECT = 'Welcome to Cureocity Mind';

const DEFAULT_TEXT = (name: string): string =>
  `Hi ${name},

Welcome to Cureocity Mind. Your account is set up and ready.

A few things you can do next:
  - Add your first client
  - Record a session — we'll write the SOAP note for you
  - Sign and share the note with your client over WhatsApp

Your transcripts, notes, and audio are encrypted and stay private to
your practice. You can request data export or erasure any time from
the client record.

If you hit anything strange or have a question, just reply to this
email.

— The Cureocity Mind team`;

const DEFAULT_HTML = (name: string): string =>
  `<p>Hi ${escapeHtml(name)},</p>
<p>Welcome to Cureocity Mind. Your account is set up and ready.</p>
<p>A few things you can do next:</p>
<ul>
  <li>Add your first client</li>
  <li>Record a session &mdash; we&rsquo;ll write the SOAP note for you</li>
  <li>Sign and share the note with your client over WhatsApp</li>
</ul>
<p>Your transcripts, notes, and audio are encrypted and stay private to your practice. You can request data export or erasure any time from the client record.</p>
<p>If you hit anything strange or have a question, just reply to this email.</p>
<p>&mdash; The Cureocity Mind team</p>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WelcomeEmailResult {
  outcome: 'sent' | 'transient_failure' | 'permanent_failure';
  providerMessageId?: string;
  errorCode?: string;
}

/**
 * Send the welcome email. Non-fatal — the caller (onboarding route)
 * logs failures but always succeeds the onboarding write. The email
 * is best-effort; a transient failure shouldn't keep a brand-new
 * therapist out of the app.
 */
export async function sendWelcomeEmail(opts: {
  to: string;
  fullName: string;
  vertical?: 'DOCTOR' | 'THERAPIST';
}): Promise<WelcomeEmailResult> {
  const scribe = opts.vertical === 'DOCTOR';
  const scribeMessage =
    'Your registration details have been submitted to Cureocity Scribe. Submission does not approve your medical registration or activate clinical access. Your account status shows any remaining administrator review.';
  const subject = scribe
    ? 'Registration received | Cureocity Scribe'
    : (process.env['WELCOME_EMAIL_SUBJECT'] ?? DEFAULT_SUBJECT);
  const textBody = scribe
    ? `Hi ${opts.fullName},\n\n${scribeMessage}\n\n— The Cureocity Scribe team`
    : (process.env['WELCOME_EMAIL_BODY_TEXT'] ?? DEFAULT_TEXT(opts.fullName));
  const htmlBody = scribe
    ? `<p>Hi ${escapeHtml(opts.fullName)},</p><p>${scribeMessage}</p><p>&mdash; The Cureocity Scribe team</p>`
    : (process.env['WELCOME_EMAIL_BODY_HTML'] ?? DEFAULT_HTML(opts.fullName));
  const port = client(scribe);
  const res = await port.sendEmail({
    to: opts.to,
    subject,
    textBody,
    htmlBody,
  });
  const out: WelcomeEmailResult = { outcome: res.outcome };
  if (res.providerMessageId !== undefined) out.providerMessageId = res.providerMessageId;
  if (res.errorCode !== undefined) out.errorCode = res.errorCode;
  return out;
}
