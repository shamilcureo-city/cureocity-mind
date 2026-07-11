import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractVerifiedClaims } from './auth';
import { TenantSpendLedger, istDayKey } from './tenant-spend';

/**
 * NEXT4 — the per-tenant daily spend circuit breaker. The per-consult
 * ceiling bounds one consult; this bounds a runaway day. These tests lock
 * the cap check, delta accumulation, the IST day rollover, and that only
 * HMAC-verified claims can feed the ledger.
 */

describe('TenantSpendLedger', () => {
  const at = (iso: string): Date => new Date(iso);

  it('accumulates deltas and trips the cap', () => {
    const ledger = new TenantSpendLedger(10);
    const now = at('2026-07-11T05:00:00Z');
    expect(ledger.isOverCap('p1', now)).toBe(false);
    ledger.add('p1', 4, now);
    ledger.add('p1', 5.9, now);
    expect(ledger.spentToday('p1', now)).toBeCloseTo(9.9);
    expect(ledger.isOverCap('p1', now)).toBe(false);
    ledger.add('p1', 0.1, now);
    expect(ledger.isOverCap('p1', now)).toBe(true);
  });

  it('is per-tenant: one clinic over cap does not shed another', () => {
    const ledger = new TenantSpendLedger(5);
    const now = at('2026-07-11T05:00:00Z');
    ledger.add('p1', 6, now);
    expect(ledger.isOverCap('p1', now)).toBe(true);
    expect(ledger.isOverCap('p2', now)).toBe(false);
  });

  it('resets on the IST day boundary, not UTC midnight', () => {
    const ledger = new TenantSpendLedger(5);
    // 17:00 UTC = 22:30 IST (same IST day); 19:00 UTC = 00:30 IST next day.
    const evening = at('2026-07-11T17:00:00Z');
    const pastIstMidnight = at('2026-07-11T19:00:00Z');
    expect(istDayKey(evening)).not.toBe(istDayKey(pastIstMidnight));
    ledger.add('p1', 6, evening);
    expect(ledger.isOverCap('p1', evening)).toBe(true);
    expect(ledger.isOverCap('p1', pastIstMidnight)).toBe(false);
    expect(ledger.spentToday('p1', pastIstMidnight)).toBe(0);
  });

  it('same UTC day across IST midnight stays split', () => {
    // Both instants are 2026-07-11 UTC but different IST days.
    expect(istDayKey(at('2026-07-11T10:00:00Z'))).toBe('2026-07-11');
    expect(istDayKey(at('2026-07-11T19:30:00Z'))).toBe('2026-07-12');
  });

  it('ignores negative and non-finite deltas', () => {
    const ledger = new TenantSpendLedger(5);
    const now = at('2026-07-11T05:00:00Z');
    ledger.add('p1', -3, now);
    ledger.add('p1', Number.NaN, now);
    ledger.add('p1', Number.POSITIVE_INFINITY, now);
    expect(ledger.spentToday('p1', now)).toBe(0);
  });

  it('cap of zero or below disables the breaker', () => {
    const disabled = new TenantSpendLedger(0);
    const now = at('2026-07-11T05:00:00Z');
    disabled.add('p1', 1_000_000, now);
    expect(disabled.enabled).toBe(false);
    expect(disabled.isOverCap('p1', now)).toBe(false);
  });

  it('sweeps stale tenants on day rollover so the map stays bounded', () => {
    const ledger = new TenantSpendLedger(100);
    const day1 = at('2026-07-11T05:00:00Z');
    const day2 = at('2026-07-12T05:00:00Z');
    ledger.add('p1', 1, day1);
    ledger.add('p2', 1, day1);
    ledger.add('p3', 1, day2); // triggers the sweep
    expect(ledger.spentToday('p1', day2)).toBe(0);
    expect(ledger.spentToday('p3', day2)).toBe(1);
  });
});

describe('extractVerifiedClaims', () => {
  const SECRET = 'test-secret';
  const SID = 'sess-123';

  function mintToken(sessionId: string, exp: number, secret = SECRET): string {
    const payload = Buffer.from(JSON.stringify({ sessionId, psychologistId: 'p1', exp })).toString(
      'base64url',
    );
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  let savedSecret: string | undefined;
  beforeEach(() => {
    savedSecret = process.env['LIVE_GATEWAY_SECRET'];
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env['LIVE_GATEWAY_SECRET'];
    else process.env['LIVE_GATEWAY_SECRET'] = savedSecret;
  });

  it('returns the claims for a valid token', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    const exp = Math.floor(Date.now() / 1000) + 300;
    const claims = extractVerifiedClaims(mintToken(SID, exp), SID);
    expect(claims).not.toBeNull();
    expect(claims?.psychologistId).toBe('p1');
    expect(claims?.sessionId).toBe(SID);
  });

  it('returns null with no secret configured — unverified claims never feed the ledger', () => {
    delete process.env['LIVE_GATEWAY_SECRET'];
    const exp = Math.floor(Date.now() / 1000) + 300;
    expect(extractVerifiedClaims(mintToken(SID, exp), SID)).toBeNull();
  });

  it('returns null for a forged signature', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    const exp = Math.floor(Date.now() / 1000) + 300;
    expect(extractVerifiedClaims(mintToken(SID, exp, 'wrong-secret'), SID)).toBeNull();
  });

  it('returns null for an expired token or a session mismatch', () => {
    process.env['LIVE_GATEWAY_SECRET'] = SECRET;
    const past = Math.floor(Date.now() / 1000) - 10;
    const future = Math.floor(Date.now() / 1000) + 300;
    expect(extractVerifiedClaims(mintToken(SID, past), SID)).toBeNull();
    expect(extractVerifiedClaims(mintToken('other-session', future), SID)).toBeNull();
  });
});
