import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sprint 18 — server-side WebAuthn registration support.
 *
 * Stateless challenge ticket: when /begin-registration is called, the
 * server generates a fresh 32-byte challenge + a signed ticket that
 * encodes (psychologistId, challenge, expiresAt). The client echoes
 * the ticket back in /finish-registration; the server verifies the
 * HMAC, checks expiry, and matches the challenge.
 *
 * No DB row needed for the transient challenge — the signed ticket IS
 * the state. Trade-off: we don't get one-shot consumption (an attacker
 * who steals a valid ticket within its 5-minute window could replay).
 * Acceptable for V1.1 (registration only, no signing-step replay risk).
 *
 * Sign-time assertion signature verification (the V1.2 step) lives in
 * apps/web/lib/webauthn-verify.ts as of Sprint 33 and is enforced by
 * the note sign route. This module remains registration-only.
 */

const TICKET_TTL_MS = 5 * 60 * 1000;

function ticketSecret(): Buffer {
  const fromEnv = process.env['WEBAUTHN_TICKET_SECRET'];
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv, 'utf8');
  // Dev fallback — deterministic so reloads don't invalidate in-flight
  // registrations. Production must set WEBAUTHN_TICKET_SECRET.
  return Buffer.from('cureocity-mind-dev-webauthn-ticket-secret-do-not-use-in-prod', 'utf8');
}

export interface RegistrationTicketPayload {
  psychologistId: string;
  challenge: string;
  expiresAt: number;
}

export function signRegistrationTicket(payload: RegistrationTicketPayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const mac = createHmac('sha256', ticketSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyRegistrationTicket(
  ticket: string,
  psychologistId: string,
): { ok: true; challenge: string } | { ok: false; reason: string } {
  const parts = ticket.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, mac] = parts as [string, string];
  const expected = createHmac('sha256', ticketSecret()).update(body).digest('base64url');
  const macBuf = Buffer.from(mac, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (macBuf.length !== expectedBuf.length) return { ok: false, reason: 'bad signature' };
  if (!timingSafeEqual(macBuf, expectedBuf)) return { ok: false, reason: 'bad signature' };
  let payload: RegistrationTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed payload' };
  }
  if (payload.psychologistId !== psychologistId) {
    return { ok: false, reason: 'ticket bound to a different user' };
  }
  if (payload.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, challenge: payload.challenge };
}

export function generateChallenge(): string {
  return randomBytes(32).toString('base64url');
}

export function ticketTtlMs(): number {
  return TICKET_TTL_MS;
}

/**
 * Verify a clientDataJSON blob matches the expected challenge + type.
 * Returns the parsed object or null if invalid.
 *
 * Note: this does NOT do full WebAuthn relying-party verification. It
 * verifies the challenge round-trips (which closes the replay window
 * to within the registration ticket's TTL) and the type tag matches.
 * Origin verification is deferred to V1.2 because the dev origin (
 * localhost) differs from prod and the env wiring isn't there yet.
 */
export interface ParsedClientData {
  type: string;
  challenge: string;
  origin: string;
}

export function parseClientDataJson(b64url: string): ParsedClientData | null {
  try {
    const json = Buffer.from(b64url, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as ParsedClientData;
    if (typeof parsed.type !== 'string' || typeof parsed.challenge !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function verifyClientDataForRegistration(
  cdj: string,
  expectedChallenge: string,
): { ok: boolean; reason?: string } {
  const parsed = parseClientDataJson(cdj);
  if (!parsed) return { ok: false, reason: 'clientDataJSON not parseable' };
  if (parsed.type !== 'webauthn.create') {
    return { ok: false, reason: `wrong type: ${parsed.type}` };
  }
  if (parsed.challenge !== expectedChallenge) {
    return { ok: false, reason: 'challenge mismatch' };
  }
  return { ok: true };
}
