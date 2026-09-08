import { createHmac } from 'node:crypto';
import type { PractitionerCapability } from '@cureocity/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAuthority } from './live-authority';

const BASE = 2_000_000_000;
const SECRET = 'fictional-renewal-test-secret';
const REQUIRED: PractitionerCapability[] = ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'];
const ALL: PractitionerCapability[] = [...REQUIRED, 'CLINICAL_ANALYSIS'];
const grant = (capabilities = ALL) =>
  new Response(JSON.stringify({ authorized: true, capabilities }));

function token(exp: number, overrides: object = {}, secret = SECRET): string {
  const payload = Buffer.from(
    JSON.stringify({
      sessionId: 'fictional-session',
      psychologistId: 'fictional-owner',
      vertical: 'DOCTOR',
      capabilities: ALL,
      exp,
      ...overrides,
    }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

describe('secure in-place authorization renewal', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const close = vi.fn();
  const updateCapabilities = vi.fn();
  const authorities: LiveAuthority[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE * 1000);
    fetchImpl.mockReset().mockImplementation(async () => grant());
    close.mockReset();
    updateCapabilities.mockReset();
  });
  afterEach(() => {
    authorities.splice(0).forEach((auth) => auth.dispose());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function authority() {
    const auth = new LiveAuthority({
      sessionId: 'fictional-session',
      psychologistId: 'fictional-owner',
      tokenExpiresAt: BASE + 300,
      vertical: 'DOCTOR',
      requiredCapabilities: new Set(REQUIRED),
      verifierUrl: 'https://fictional.internal/api/v1/internal/live-authority',
      serviceSecret: SECRET,
      fetchImpl,
      timeoutMs: 50,
      close,
      updateCapabilities,
    });
    authorities.push(auth);
    auth.start();
    return auth;
  }

  it('continues beyond multiple five-minute boundaries, then expires without another renewal', async () => {
    const auth = authority();
    for (let renewal = 1; renewal <= 3; renewal++) {
      await vi.advanceTimersByTimeAsync(240_000);
      const expiresAt = BASE + renewal * 240 + 300;
      await expect(auth.renewToken(token(expiresAt))).resolves.toBe(expiresAt);
      await expect(auth.authorizeCurrentInput()).resolves.toBe(true);
      expect(close).not.toHaveBeenCalled();
    }
    // Twelve minutes of one authority, not a reconstructed capture session.
    await vi.advanceTimersByTimeAsync(299_999);
    expect(auth.authorizeInput()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(auth.authorizeInput()).toBe(false);
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_denied');
  });

  it.each([
    ['signature', () => token(BASE + 600, {}, 'wrong-secret')],
    ['session', () => token(BASE + 600, { sessionId: 'other-session' })],
    ['practitioner', () => token(BASE + 600, { psychologistId: 'other-owner' })],
    [
      'vertical',
      () =>
        token(BASE + 600, {
          vertical: 'THERAPIST',
          capabilities: ['LIVE_ENCOUNTER', 'BEHAVIORAL_HEALTH_DOCUMENTATION'],
        }),
    ],
    ['expired', () => token(BASE)],
    ['equal expiry replay', () => token(BASE + 300)],
    ['older expiry', () => token(BASE + 299)],
    ['fractional expiry', () => token(BASE + 600.5)],
    ['unsafe expiry', () => token(Number.MAX_SAFE_INTEGER + 1)],
    ['missing mandatory scope', () => token(BASE + 600, { capabilities: ['LIVE_ENCOUNTER'] })],
    ['malformed', () => 'invalid-token'],
  ])('fails closed for %s before querying new authority', async (_label, input) => {
    const auth = authority();
    await expect(auth.renewToken(input())).resolves.toBeNull();
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_denied');
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(auth.renewToken(token(BASE + 900))).resolves.toBeNull();
  });

  it.each([
    ['revoked consent', () => new Response('{}', { status: 403 })],
    ['revoked capability', () => grant(['LIVE_ENCOUNTER'])],
    ['invalid verifier response', () => new Response('{}')],
  ])('requires current server authority: %s', async (_label, response) => {
    fetchImpl.mockImplementation(async () => response());
    await expect(authority().renewToken(token(BASE + 600))).resolves.toBeNull();
    expect(close).toHaveBeenCalledWith('live_authority_denied');
    expect(updateCapabilities).not.toHaveBeenCalled();
  });

  it('uses verifier capabilities, never the renewed token alone, and sends no token or clinical data', async () => {
    fetchImpl.mockImplementation(async () => grant(REQUIRED));
    const auth = authority();
    await expect(auth.renewToken(token(BASE + 600))).resolves.toBe(BASE + 600);
    expect(updateCapabilities).toHaveBeenLastCalledWith(new Set(REQUIRED));
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      sessionId: 'fictional-session',
      psychologistId: 'fictional-owner',
      tokenExpiresAt: BASE + 600,
      vertical: 'DOCTOR',
    });
  });

  it('waits for an old in-flight grant, then gates concurrent input/output behind the fresh snapshot', async () => {
    const old = deferredResponse();
    const fresh = deferredResponse();
    fetchImpl.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const auth = authority();
    const inputBefore = auth.authorizeCurrentInput();
    const renewal = auth.renewToken(token(BASE + 600));
    const inputDuring = auth.authorizeCurrentInput();
    const outputDuring = auth.authorizeEvent({ type: 'note', partial: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    old.resolve(grant());
    await expect(inputBefore).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(updateCapabilities).toHaveBeenCalledTimes(1);
    fresh.resolve(grant(REQUIRED));
    await expect(renewal).resolves.toBe(BASE + 600);
    await expect(inputDuring).resolves.toBe(true);
    await expect(outputDuring).resolves.toEqual({ type: 'note', partial: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // post-renew checks coalesce
    expect(close).not.toHaveBeenCalled();
  });

  it('cannot override an old in-flight denial with a newer signed token', async () => {
    const old = deferredResponse();
    fetchImpl.mockImplementationOnce(() => old.promise);
    const auth = authority();
    const input = auth.authorizeCurrentInput();
    const renewal = auth.renewToken(token(BASE + 600));
    old.resolve(new Response('{}', { status: 403 }));
    await expect(input).resolves.toBe(false);
    await expect(renewal).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_denied');
  });

  it('keeps the old expiry armed while renewal is pending and ignores its late success', async () => {
    const pending = deferredResponse();
    fetchImpl.mockImplementationOnce(() => pending.promise);
    const auth = authority();
    const renewal = auth.renewToken(token(BASE + 600));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_denied');
    pending.resolve(grant());
    await expect(renewal).resolves.toBeNull();
    expect(updateCapabilities).not.toHaveBeenCalled();
    expect(auth.authorizeInput()).toBe(false);
  });

  it('cannot revive disposed authority with a late verifier response', async () => {
    const pending = deferredResponse();
    fetchImpl.mockImplementationOnce(() => pending.promise);
    const auth = authority();
    const renewal = auth.renewToken(token(BASE + 600));
    auth.dispose();
    pending.resolve(grant());
    await expect(renewal).resolves.toBeNull();
    await expect(auth.authorizeCurrentInput()).resolves.toBe(false);
    expect(updateCapabilities).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop/drain prevents pending and subsequent renewal but preserves authorized final work', async () => {
    const pending = deferredResponse();
    fetchImpl.mockImplementationOnce(() => pending.promise);
    const auth = authority();
    const renewal = auth.renewToken(token(BASE + 600));
    const input = auth.authorizeCurrentInput();
    auth.preventRenewal();
    pending.resolve(grant());
    await expect(renewal).resolves.toBeNull();
    await expect(input).resolves.toBe(true);
    await expect(auth.renewToken(token(BASE + 900))).resolves.toBeNull();
    await expect(auth.authorizeEvent({ type: 'note', partial: {} })).resolves.toEqual({
      type: 'note',
      partial: {},
    });
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(close).toHaveBeenCalledWith('live_authority_denied');
  });

  it('fails closed on bounded verifier timeout and cannot accept a late renewal', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    fetchImpl.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        }),
    );
    const auth = authority();
    const renewal = auth.renewToken(token(BASE + 600));
    await vi.advanceTimersByTimeAsync(50);
    await expect(renewal).resolves.toBeNull();
    expect(close).toHaveBeenCalledExactlyOnceWith('live_authority_unavailable');
    await expect(auth.renewToken(token(BASE + 900))).resolves.toBeNull();
  });
});
