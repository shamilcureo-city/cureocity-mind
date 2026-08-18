import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authRequired,
  extractVerifiedClaims,
  isFailClosedMisconfig,
  verifyStartToken,
} from './auth';

/**
 * DOC-4 — the gateway must fail CLOSED in production when the secret is
 * unset (an unauthenticated PHI-accepting socket is worse than a down node),
 * while staying open for local/mock dev. These tests lock that posture.
 */

const SECRET = 'test-secret';
const SID = 'sess-123';

function mintToken(sessionId: string, exp: number, secret = SECRET, extra: object = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId,
      psychologistId: 'p1',
      exp,
      vertical: 'DOCTOR',
      capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'],
      ...extra,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

describe('live-gateway auth', () => {
  let savedSecret: string | undefined;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedSecret = process.env['LIVE_GATEWAY_SECRET'];
    savedEnv = process.env['NODE_ENV'];
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env['LIVE_GATEWAY_SECRET'];
    else process.env['LIVE_GATEWAY_SECRET'] = savedSecret;
    if (savedEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = savedEnv;
  });

  it('runs OPEN in dev when no secret is set', () => {
    delete process.env['LIVE_GATEWAY_SECRET'];
    process.env['NODE_ENV'] = 'development';
    expect(authRequired()).toBe(false);
    expect(isFailClosedMisconfig()).toBe(false);
    expect(verifyStartToken(undefined, undefined)).toBe(true);
  });

  it('fails CLOSED in production when no secret is set', () => {
    delete process.env['LIVE_GATEWAY_SECRET'];
    process.env['NODE_ENV'] = 'production';
    expect(authRequired()).toBe(true);
    expect(isFailClosedMisconfig()).toBe(true);
    // Every start is rejected — even a would-be valid token can't be verified.
    expect(verifyStartToken(mintToken(SID, future()), SID)).toBe(false);
    expect(verifyStartToken(undefined, SID)).toBe(false);
  });

  it('accepts a well-formed, unexpired, session-bound token when the secret is set', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    process.env['NODE_ENV'] = 'production';
    expect(authRequired()).toBe(true);
    expect(isFailClosedMisconfig()).toBe(false);
    expect(verifyStartToken(mintToken(SID, future()), SID)).toBe(true);
  });

  it('rejects an expired token, a wrong-session token, and a wrong-secret signature', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    expect(verifyStartToken(mintToken(SID, past()), SID)).toBe(false); // expired
    expect(verifyStartToken(mintToken('other', future()), SID)).toBe(false); // wrong session
    expect(verifyStartToken(mintToken(SID, future(), 'wrong-secret'), SID)).toBe(false); // bad sig
    expect(verifyStartToken('garbage', SID)).toBe(false);
  });

  it('requires signed live/documentation scopes and returns only validated scoped claims', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    const token = mintToken(SID, future(), SECRET, {
      vertical: 'DOCTOR',
      capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'],
    });
    expect(extractVerifiedClaims(token, SID)).toEqual({
      sessionId: SID,
      psychologistId: 'p1',
      exp: expect.any(Number),
      vertical: 'DOCTOR',
      capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION', 'CLINICAL_ANALYSIS'],
    });
    expect(
      verifyStartToken(
        mintToken(SID, future(), SECRET, {
          vertical: 'DOCTOR',
          capabilities: ['LIVE_ENCOUNTER', 'CLINICAL_ANALYSIS'],
        }),
        SID,
      ),
    ).toBe(false);
  });
});

function future(): number {
  return Math.floor(Date.now() / 1000) + 300;
}
function past(): number {
  return Math.floor(Date.now() / 1000) - 10;
}
