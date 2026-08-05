import { createHmac, timingSafeEqual } from 'node:crypto';
import { publicBaseUrl } from './appointment-links';

/**
 * VS1 — signed client join links for SESSION video rooms (the Record
 * screen's "Virtual" option). Same trust model as the appointment links:
 * the signature proves the link came from us without any auth session, so
 * the client can join from any browser with nothing installed.
 *
 * The HMAC payload is prefixed (`svid:`) so a session-join signature can
 * never be replayed against the appointment endpoints or vice versa, even
 * though both use the same key.
 */

function key(): string {
  return (
    process.env['APPOINTMENT_LINK_SECRET'] ??
    process.env['CRON_SECRET'] ??
    'dev-appointment-link-secret'
  );
}

export function signSessionVideoId(sessionId: string): string {
  return createHmac('sha256', key()).update(`svid:${sessionId}`).digest('hex').slice(0, 32);
}

export function verifySessionVideoSig(sessionId: string, sig: string): boolean {
  const expected = signSessionVideoId(sessionId);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** The absolute link the therapist shares (WhatsApp / copy). */
export function sessionJoinUrl(sessionId: string): string {
  return `${publicBaseUrl()}/p/sessions/${sessionId}/join?sig=${signSessionVideoId(sessionId)}`;
}
