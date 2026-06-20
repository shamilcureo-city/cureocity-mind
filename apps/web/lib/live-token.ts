import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sprint DV8 hardening — short-lived signed tokens for the live gateway.
 *
 * The live copilot socket (`services/live-gateway`) is a standalone
 * service that can't share the Firebase session. Instead, the app mints a
 * stateless HMAC token here (after verifying the practitioner owns the
 * session) and the gateway verifies it with the SAME secret before it
 * streams. Token = `base64url(JSON{sessionId,psychologistId,exp}) . sig`,
 * where sig = HMAC-SHA256(payload) hex.
 *
 * The verify side (`services/live-gateway/src/auth.ts`) MUST stay in
 * lock-step with this format + algorithm.
 *
 * Secret resolution: `LIVE_GATEWAY_SECRET` in prod. When unset, a clearly
 * insecure dev default is used and the gateway skips verification — so
 * local/mock dev works with no setup, exactly like the auth-bypass
 * pattern elsewhere in the codebase.
 */
const DEV_SECRET = 'dev-insecure-live-gateway-secret';
const DEFAULT_TTL_SEC = 300; // 5 minutes — long enough to start a consult.

function secret(): string {
  return process.env['LIVE_GATEWAY_SECRET'] ?? DEV_SECRET;
}

export interface LiveTokenClaims {
  sessionId: string;
  psychologistId: string;
  /** Unix seconds. */
  exp: number;
}

export function signLiveToken(
  input: { sessionId: string; psychologistId: string },
  ttlSec: number = DEFAULT_TTL_SEC,
): { token: string; expiresInSec: number } {
  const claims: LiveTokenClaims = {
    sessionId: input.sessionId,
    psychologistId: input.psychologistId,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, expiresInSec: ttlSec };
}

/** Verify a token (used in tests; the gateway has its own copy). */
export function verifyLiveToken(token: string, sessionId: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as LiveTokenClaims;
    if (claims.sessionId !== sessionId) return false;
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}
