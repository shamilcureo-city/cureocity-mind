import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function route(relative: string): string {
  return readFileSync(resolve(process.cwd(), 'app/api/v1', relative, 'route.ts'), 'utf8');
}

describe('session lifecycle route concurrency architecture', () => {
  it.each([
    'sessions/[id]/start',
    'sessions/[id]/live-token',
    'sessions/[id]/consent',
    'clients/[id]/dsr/consent-withdrawal',
  ])('serializes %s on the shared client consent row lock', (path) => {
    expect(route(path)).toContain('withClientConsentLock(');
  });

  it('authorizes and signs live tokens inside the same locked transaction', () => {
    const source = route('sessions/[id]/live-token');
    const lock = source.indexOf('withClientConsentLock(');
    const authorization = source.indexOf('assertLiveTokenSessionStatus(', lock);
    const token = source.indexOf('return signLiveToken(', authorization);

    expect(lock).toBeGreaterThan(-1);
    expect(authorization).toBeGreaterThan(lock);
    expect(token).toBeGreaterThan(authorization);
  });

  it.each(['sessions/[id]/start', 'sessions/[id]/live-token'])(
    'uses the centralized complete snapshot and standing-grant predicate in %s',
    (path) => {
      const source = route(path);
      const lock = source.indexOf('withClientConsentLock(');
      const authorization = source.indexOf('assertValidScribeConsent(', lock);

      expect(authorization).toBeGreaterThan(lock);
    },
  );

  it.each([
    ['sessions/[id]/reschedule', "expectedStatus: 'SCHEDULED'"],
    ['sessions/[id]/no-show/undo', "expectedStatus: 'NO_SHOW'"],
  ])('uses a conditional lifecycle transition in %s', (path, expectedStatus) => {
    const source = route(path);
    expect(source).toContain('conditionalSessionTransition(');
    expect(source).toContain(expectedStatus);
    expect(source).not.toContain('tx.session.update({');
  });

  it('creates a replacement only after reschedule wins the conditional transition', () => {
    const source = route('sessions/[id]/reschedule');
    expect(source.indexOf('conditionalSessionTransition(')).toBeLessThan(
      source.indexOf('tx.session.create('),
    );
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
  });

  it('returns the stable conflict response when consent snapshot loses to start', () => {
    const source = route('sessions/[id]/consent');
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
    expect(source).toContain("expectedStatus: 'SCHEDULED'");
  });

  it.each(['sessions/[id]/consent', 'clients/[id]/dsr/consent-withdrawal'])(
    'does not treat expired grants as active in %s',
    (path) => {
      expect(route(path)).toContain('expiresAt: { gt: now }');
    },
  );

  it('conditionally cancels a linked scheduled session and maps a lost race to 409', () => {
    const source = route('public/appointments/[id]/cancel');

    expect(source).toContain('conditionalSessionTransition(');
    expect(source).toContain("expectedStatus: 'SCHEDULED'");
    expect(source).toContain('sessionConcurrentModificationResponse(error)');
  });
});
