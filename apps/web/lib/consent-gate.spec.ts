import { describe, expect, it, vi } from 'vitest';
import {
  consentAuthorizationResponse,
  ConsentAuthorizationError,
  withClientConsentLock,
} from './consent-gate';

describe('client consent mutation boundary', () => {
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
