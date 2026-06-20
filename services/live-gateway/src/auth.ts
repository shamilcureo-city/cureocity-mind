import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sprint DV8 hardening — verify the live-start token minted by the app
 * (`apps/web/lib/live-token.ts`). MUST stay in lock-step with that
 * format + algorithm: token = `base64url(JSON{sessionId,psychologistId,
 * exp}) . HMAC-SHA256(payload)`.
 *
 * Auth is enforced only when `LIVE_GATEWAY_SECRET` is set. When unset
 * (local/mock dev) the gateway runs open — same auth-bypass posture the
 * app uses when Firebase env is missing. Set the secret on BOTH the app
 * and the gateway in prod to require a valid token.
 */
interface LiveTokenClaims {
  sessionId: string;
  psychologistId: string;
  exp: number;
}

/** True if auth is required (the secret is configured). */
export function authRequired(): boolean {
  return !!process.env['LIVE_GATEWAY_SECRET'];
}

/**
 * Verify a token for `sessionId`. Returns true when auth is not required
 * (dev) OR the token is present, well-formed, unexpired, signed with the
 * shared secret, and bound to this session.
 */
export function verifyStartToken(
  token: string | undefined,
  sessionId: string | undefined,
): boolean {
  const secret = process.env['LIVE_GATEWAY_SECRET'];
  if (!secret) return true; // dev / mock — open
  if (!token || !sessionId) return false;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
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
