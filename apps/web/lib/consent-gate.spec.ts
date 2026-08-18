import { describe, expect, it, vi } from 'vitest';
import {
  assertValidScribeConsent,
  consentAuthorizationResponse,
  ConsentAuthorizationError,
  withClientConsentLock,
} from './consent-gate';

const completeSnapshot = {
  entries: [
    { scope: 'AUDIO_RECORDING' },
    { scope: 'AI_NOTE_GENERATION' },
    { scope: 'CROSS_BORDER_PROCESSING' },
  ],
};

function consentDb(rows: unknown[]) {
  return { consent: { findMany: vi.fn().mockResolvedValue(rows) } };
}

const validGrant = (scope: string) => ({
  scope,
  status: 'GRANTED',
  withdrawnAt: null,
  expiresAt: null,
});

describe('client consent mutation boundary', () => {
  it('fails closed when the session snapshot is missing a required scribe scope', async () => {
    const db = consentDb([]);

    await expect(
      assertValidScribeConsent(
        { entries: completeSnapshot.entries.slice(0, 2) },
        'client-1',
        db as never,
        new Date('2026-08-18T10:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    expect(db.consent.findMany).not.toHaveBeenCalled();
  });

  it('fails closed when a required standing grant is absent', async () => {
    const db = consentDb([validGrant('AUDIO_RECORDING'), validGrant('AI_NOTE_GENERATION')]);

    await expect(
      assertValidScribeConsent(
        completeSnapshot,
        'client-1',
        db as never,
        new Date('2026-08-18T10:00:00Z'),
      ),
    ).rejects.toThrow(/CROSS_BORDER_PROCESSING/);
  });

  it.each([
    ['WITHDRAWN status', { status: 'WITHDRAWN', withdrawnAt: new Date(), expiresAt: null }],
    ['EXPIRED status', { status: 'EXPIRED', withdrawnAt: null, expiresAt: null }],
    ['withdrawal timestamp', { status: 'GRANTED', withdrawnAt: new Date(), expiresAt: null }],
    [
      'past expiry',
      { status: 'GRANTED', withdrawnAt: null, expiresAt: new Date('2026-08-18T09:59:59Z') },
    ],
    [
      'expiry at the authorization instant',
      { status: 'GRANTED', withdrawnAt: null, expiresAt: new Date('2026-08-18T10:00:00Z') },
    ],
  ])('rejects a required grant with %s', async (_case, invalidGrant) => {
    const db = consentDb([
      validGrant('AUDIO_RECORDING'),
      validGrant('AI_NOTE_GENERATION'),
      { scope: 'CROSS_BORDER_PROCESSING', ...invalidGrant },
    ]);

    await expect(
      assertValidScribeConsent(
        completeSnapshot,
        'client-1',
        db as never,
        new Date('2026-08-18T10:00:00Z'),
      ),
    ).rejects.toThrow(/CROSS_BORDER_PROCESSING/);
  });

  it('accepts complete snapshot scopes backed by unexpired standing grants', async () => {
    const db = consentDb([
      validGrant('AUDIO_RECORDING'),
      validGrant('AI_NOTE_GENERATION'),
      {
        ...validGrant('CROSS_BORDER_PROCESSING'),
        expiresAt: new Date('2026-08-18T10:00:01Z'),
      },
    ]);

    await expect(
      assertValidScribeConsent(
        completeSnapshot,
        'client-1',
        db as never,
        new Date('2026-08-18T10:00:00Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('waits for the PostgreSQL client-row lock before authorizing capture', async () => {
    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const tx = {
      $queryRaw: vi.fn().mockReturnValue(lock),
    };
    const authorize = vi.fn().mockResolvedValue('authorized');

    const result = withClientConsentLock(tx as never, 'client-1', authorize);
    await Promise.resolve();

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(authorize).not.toHaveBeenCalled();

    releaseLock();
    await expect(result).resolves.toBe('authorized');
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('maps consent changes during capture authorization to a stable 409', async () => {
    const response = consentAuthorizationResponse(
      new ConsentAuthorizationError('Consent changed while capture was starting'),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: 'Consent changed while capture was starting',
      code: 'SESSION_CONSENT_INVALID',
    });
  });

  it('does not enter the authorization unit when the row lock fails', async () => {
    const lockError = new Error('lock failed');
    const tx = { $queryRaw: vi.fn().mockRejectedValue(lockError) };
    const authorize = vi.fn();

    await expect(withClientConsentLock(tx as never, 'client-1', authorize)).rejects.toBe(lockError);
    expect(authorize).not.toHaveBeenCalled();
  });
});
