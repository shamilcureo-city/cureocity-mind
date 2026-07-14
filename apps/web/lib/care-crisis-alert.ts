import * as Sentry from '@sentry/nextjs';
import { NoopBackend, SendGridBackend } from '@cureocity/notifications';
import type { IEmailPort } from '@cureocity/notifications';

/**
 * Cureocity Care — the HUMAN half of crisis escalation (PROD6).
 *
 * `escalateCareSession` hard-stops the session, sets SAFETY_HOLD, and
 * writes audit rows — but audit rows don't wake anyone up. The Care
 * runbook's on-call section presumes a human learns about every
 * CARE_CRISIS_ESCALATED promptly; this module is that notification:
 *
 *   1. An email to CARE_CRISIS_ALERT_EMAIL (comma-separated for a rota),
 *      PII-minimal like crisis-alert.ts — ids only, no name, no content.
 *   2. A Sentry event tagged care-crisis, so the existing new-issue
 *      alert rule fires even when the email env is unset.
 *
 * Never throws — the escalation itself (session stop + safety hold) must
 * never be blocked by a notification failure.
 */

declare global {
  var __cureocityCareCrisisEmail: IEmailPort | undefined;
}

function emailPort(): IEmailPort {
  if (globalThis.__cureocityCareCrisisEmail) return globalThis.__cureocityCareCrisisEmail;
  const apiKey = process.env['SENDGRID_API_KEY'];
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'];
  const fromName = process.env['SENDGRID_FROM_NAME'] ?? 'Cureocity Care';
  const port: IEmailPort =
    apiKey && fromEmail ? new SendGridBackend({ apiKey, fromEmail, fromName }) : new NoopBackend();
  globalThis.__cureocityCareCrisisEmail = port;
  return port;
}

const SUBJECT = 'CRISIS ESCALATION — a Care session was safety-stopped';

const TEXT = (careSessionId: string, careUserId: string, source: string): string =>
  `A Cureocity Care session was crisis-escalated and the account was placed on safety hold.

  Care session: ${careSessionId}
  Care user:    ${careUserId}
  Trigger:      ${source}

The user was shown crisis hotlines and their trusted contact in-app.
Follow the on-call procedure in docs/runbooks/care.md — review the audit
trail for this session id and complete the outreach checklist.

This alert intentionally contains no name or session content.`;

/**
 * Notify the on-call human about a Care crisis escalation. Call AFTER the
 * escalation transaction has committed. Never throws; logs every outcome.
 */
export async function notifyCareCrisisOnCall(input: {
  careSessionId: string;
  careUserId: string;
  source: string;
}): Promise<void> {
  // Sentry first — it has no config dependency beyond the DSN that is
  // already live in prod, so the on-call signal survives a missing email env.
  try {
    Sentry.captureMessage('Care crisis escalation — session safety-stopped', {
      level: 'error',
      tags: { area: 'care-crisis', source: input.source },
      extra: { careSessionId: input.careSessionId, careUserId: input.careUserId },
    });
  } catch {
    /* Sentry unavailable — the email + log below still run */
  }

  const recipients = (process.env['CARE_CRISIS_ALERT_EMAIL'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    console.error(
      `[care-crisis] ESCALATION for session ${input.careSessionId} — CARE_CRISIS_ALERT_EMAIL is unset, no on-call email sent. Set it so a human is paged.`,
    );
    return;
  }

  for (const to of recipients) {
    try {
      const res = await emailPort().sendEmail({
        to,
        subject: SUBJECT,
        textBody: TEXT(input.careSessionId, input.careUserId, input.source),
      });
      console.log(
        `[care-crisis] on-call alert to ${to}: ${res.outcome} (session ${input.careSessionId})`,
      );
    } catch (e) {
      console.error(`[care-crisis] on-call alert to ${to} FAILED: ${(e as Error).message}`);
    }
  }
}
