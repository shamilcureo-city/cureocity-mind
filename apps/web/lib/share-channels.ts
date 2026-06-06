import { NoopBackend, SendGridBackend, WatiBackend } from '@cureocity/notifications';
import type { IEmailPort, IMessagingPort } from '@cureocity/notifications';

/**
 * Sprint 15 — Patient sharing channel adapters.
 *
 * Wraps the @cureocity/notifications backends with env-driven
 * initialisation. Falls back to the Noop backend in dev/CI when
 * credentials are absent — the Noop captures calls so the route
 * still produces a PatientShare row with a coherent providerMessageId.
 *
 * In production with WATI_BEARER_TOKEN + SENDGRID_API_KEY set, real
 * WhatsApp + email sends go out.
 *
 * Module-scoped cache so warm function reuse skips re-init.
 */

declare global {
  var __cureocityShareChannels:
    | {
        messaging: IMessagingPort;
        email: IEmailPort;
        backend: 'noop' | 'wati+sendgrid' | 'mixed';
      }
    | undefined;
}

interface ShareChannels {
  messaging: IMessagingPort;
  email: IEmailPort;
  backend: 'noop' | 'wati+sendgrid' | 'mixed';
}

export function shareChannels(): ShareChannels {
  if (globalThis.__cureocityShareChannels) {
    return globalThis.__cureocityShareChannels;
  }
  const watiBase = process.env['WATI_API_BASE'];
  const watiToken = process.env['WATI_BEARER_TOKEN'];
  const sendgridKey = process.env['SENDGRID_API_KEY'];
  const fromEmail = process.env['SENDGRID_FROM_EMAIL'];
  const fromName = process.env['SENDGRID_FROM_NAME'] ?? 'Cureocity Mind';

  let messaging: IMessagingPort;
  let email: IEmailPort;
  const watiReady = Boolean(watiBase && watiToken);
  const sendgridReady = Boolean(sendgridKey && fromEmail);

  if (watiReady && watiToken) {
    messaging = new WatiBackend({ apiBase: watiBase!, bearerToken: watiToken });
  } else {
    console.info('[share-channels] WATI env unset — using NoopBackend for WhatsApp');
    messaging = new NoopBackend();
  }
  if (sendgridReady && sendgridKey && fromEmail) {
    email = new SendGridBackend({ apiKey: sendgridKey, fromEmail, fromName });
  } else {
    console.info('[share-channels] SendGrid env unset — using NoopBackend for email');
    // Fresh Noop so the captured calls list doesn't share with messaging.
    email = new NoopBackend();
  }

  const backend: ShareChannels['backend'] =
    watiReady && sendgridReady ? 'wati+sendgrid' : !watiReady && !sendgridReady ? 'noop' : 'mixed';
  const cached: ShareChannels = { messaging, email, backend };
  globalThis.__cureocityShareChannels = cached;
  return cached;
}
