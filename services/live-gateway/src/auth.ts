import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sprint DV8 hardening — verify the live-start token minted by the app
 * (`apps/web/lib/live-token.ts`). MUST stay in lock-step with that
 * format + algorithm: token = `base64url(JSON{sessionId,psychologistId,
 * exp}) . HMAC-SHA256(payload)`.
 *
 * Auth is enforced whenever `LIVE_GATEWAY_SECRET` is set. When unset:
 *   - in production (NODE_ENV=production) the gateway fails CLOSED —
 *     every `start` is rejected — because an unauthenticated WS that
 *     accepts PHI audio and runs real Vertex passes is far worse than a
 *     down node. This mirrors the app's `isAuthBypassed()` fail-closed
 *     posture (DOC-4).
 *   - otherwise (local/mock dev) it runs open for convenience.
 * Set the secret on BOTH the app and the gateway in prod.
 */
interface LiveTokenClaims {
  sessionId: string;
  psychologistId: string;
  exp: number;
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * True if the gateway is misconfigured for production: running in prod
 * with no secret set. The server refuses every `start` in this state.
 */
export function isFailClosedMisconfig(): boolean {
  return isProduction() && !process.env['LIVE_GATEWAY_SECRET'];
}

/** True if auth is required (the secret is configured, or we're in prod). */
export function authRequired(): boolean {
  return !!process.env['LIVE_GATEWAY_SECRET'] || isProduction();
}

/**
 * Verify a token for `sessionId`. Returns true when auth is not required
 * (dev with no secret) OR the token is present, well-formed, unexpired,
 * signed with the shared secret, and bound to this session. In production
 * with no secret it returns false (fail closed).
 */
export function verifyStartToken(
  token: string | undefined,
  sessionId: string | undefined,
): boolean {
  const secret = process.env['LIVE_GATEWAY_SECRET'];
  if (!secret) return !isProduction(); // dev/mock → open; prod → fail closed
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
