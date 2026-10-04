import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionBoundFetch, type SessionBoundUser } from './session-bound-fetch';

const UID = 'fictional-page-uid';
const TOKEN = 'fictional-token-not-a-real-credential';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(origin = 'https://scribe.cureocity.in') {
  const user = { uid: UID, getIdToken: vi.fn(async () => TOKEN) };
  let active: SessionBoundUser | null = user;
  const getUser = vi.fn(async () => active);
  const network = vi.fn<typeof fetch>(async () => Response.json({ fictional: true }));
  const bound = createSessionBoundFetch({ fetch: network, origin, expectedUid: UID, getUser });
  return {
    bound,
    network,
    getUser,
    user,
    setUser: (value: SessionBoundUser | null) => {
      active = value;
    },
  };
}

function sentHeaders(f: ReturnType<typeof fixture>, call = 0) {
  return new Headers(f.network.mock.calls[call]?.[1]?.headers);
}

afterEach(() => vi.useRealTimers());

describe('page-bound practitioner identity transport', () => {
  it.each(['https://scribe.cureocity.in', 'https://mind.cureocity.in'])(
    'binds matching identity on %s without changing caller credentials/body/cache',
    async (origin) => {
      const f = fixture(origin);
      const response = await f.bound.fetch('/api/v1/reception', {
        method: 'POST',
        body: '{"fictional":true}',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-request-id': 'synthetic-request' },
      });
      expect(response.status).toBe(200);
      expect(f.network).toHaveBeenCalledOnce();
      expect(f.network.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        body: '{"fictional":true}',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(sentHeaders(f).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(sentHeaders(f).get('x-cureocity-session-uid')).toBe(UID);
      expect(sentHeaders(f).get('x-request-id')).toBe('synthetic-request');
      expect(f.getUser).toHaveBeenCalledTimes(2);
      expect(f.bound.getProblem()).toBeNull();
    },
  );

  it('blocks a different known Firebase UID before token lookup or network', async () => {
    const f = fixture();
    const otherToken = vi.fn(async () => 'other-fictional-token');
    f.setUser({ uid: 'other-fictional-uid', getIdToken: otherToken });
    const response = await f.bound.fetch('/api/v1/sessions', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'SESSION_IDENTITY_MISMATCH' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.bound.getProblem()).toBe('SESSION_IDENTITY_MISMATCH');
    expect(otherToken).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
  });

  it('preserves a Request body, headers and signal without mutating or consuming it', async () => {
    const f = fixture();
    const controller = new AbortController();
    const original = new Request('https://scribe.cureocity.in/api/v1/reception', {
      method: 'PATCH',
      body: '{"action":"fictional"}',
      signal: controller.signal,
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-existing': 'kept' },
    });
    await f.bound.fetch(original);
    expect(f.network.mock.calls[0]?.[0]).toBe(original);
    expect(original.signal.aborted).toBe(false);
    expect(original.credentials).toBe('include');
    expect(original.headers.has('authorization')).toBe(false);
    expect(original.headers.has('x-cureocity-session-uid')).toBe(false);
    expect(original.bodyUsed).toBe(false);
    expect(sentHeaders(f).get('content-type')).toBe('application/json');
    expect(sentHeaders(f).get('x-existing')).toBe('kept');
    expect(await original.text()).toBe('{"action":"fictional"}');
  });

  it('preserves explicit Authorization, replaces Request headers via init, and stamps the actual page assertion', async () => {
    const f = fixture();
    const original = new Request('https://scribe.cureocity.in/api/v1/clients', {
      headers: { 'x-old': 'replaced' },
    });
    const headers = new Headers({
      Authorization: 'Bearer explicit-token',
      'x-cureocity-session-uid': 'caller-cannot-change-page',
      'x-new': 'kept',
    });
    await f.bound.fetch(original, { headers, credentials: 'omit' });
    expect(sentHeaders(f).get('authorization')).toBe('Bearer explicit-token');
    expect(sentHeaders(f).get('x-cureocity-session-uid')).toBe(UID);
    expect(sentHeaders(f).get('x-old')).toBeNull();
    expect(sentHeaders(f).get('x-new')).toBe('kept');
    expect(headers.get('x-cureocity-session-uid')).toBe('caller-cannot-change-page');
    expect(f.user.getIdToken).not.toHaveBeenCalled();
    expect(f.network.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('permits an initial null Firebase user with cookie-only auth plus page assertion', async () => {
    const f = fixture();
    f.setUser(null);
    await f.bound.fetch('/api/v1/patients');
    expect(sentHeaders(f).has('authorization')).toBe(false);
    expect(sentHeaders(f).get('x-cureocity-session-uid')).toBe(UID);
    expect(f.network.mock.calls[0]?.[1]?.credentials).toBeUndefined();
    expect(f.bound.getProblem()).toBeNull();
  });

  it.each([
    '/api/v1',
    '/api/v1/',
    '/api/v1?query=true',
    '/api/v1/clients',
    '/api/v1/patients',
    '/api/v1/share',
    '/api/v1/publicity',
    '/api/v1/careful',
    '/api/v1/auth/session-extra',
    'https://scribe.cureocity.in/api/v1/sessions',
  ])('guards exact same-origin API path %s', async (input) => {
    const f = fixture();
    await f.bound.fetch(input);
    expect(sentHeaders(f).get('x-cureocity-session-uid')).toBe(UID);
  });

  it.each([
    '/app/clinic',
    '/api/v10/clients',
    '/api/v1x',
    '/api/v1.evil',
    '/api/v1%2fclients',
    '/proxy/api/v1/clients',
    '/api/v1/../v10/clients',
    'https://scribe.cureocity.in.evil.example/api/v1/clients',
    'https://mind.cureocity.in/api/v1/clients',
    'http://scribe.cureocity.in/api/v1/clients',
    'https://scribe.cureocity.in:444/api/v1/clients',
    '//other.example/api/v1/clients',
    '/api/v1/auth/session',
    '/api/v1/auth/session/?x=1',
    '/api/v1/auth/signout',
    '/api/v1/auth/signout/',
    '/api/v1/care',
    '/api/v1/care/sessions',
    '/api/v1/public',
    '/api/v1/public/reception/example',
    '/api/v1/p',
    '/api/v1/p/home',
    '/api/v1/p/token/homework',
  ])('leaves excluded/non-practitioner input %s unchanged', async (input) => {
    const f = fixture();
    const init: RequestInit = {
      method: 'POST',
      body: 'unchanged',
      headers: { 'x-original': 'yes' },
      redirect: 'follow',
    };
    await f.bound.fetch(input, init);
    expect(f.network).toHaveBeenCalledWith(input, init);
    expect(f.network.mock.calls[0]?.[1]).toBe(init);
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.user.getIdToken).not.toHaveBeenCalled();
    expect(sentHeaders(f).has('authorization')).toBe(false);
    expect(sentHeaders(f).has('x-cureocity-session-uid')).toBe(false);
  });

  it('handles a URL object and prevents guarded API redirects from forwarding identity headers', async () => {
    const f = fixture();
    await f.bound.fetch(new URL('https://scribe.cureocity.in/api/v1/reception'), {
      redirect: 'follow',
    });
    expect(f.network.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('waits for Firebase readiness before token acquisition or dispatch', async () => {
    const f = fixture();
    const ready = deferred<SessionBoundUser | null>();
    f.getUser.mockReturnValueOnce(ready.promise);
    const result = f.bound.fetch('/api/v1/sessions', { method: 'POST' });
    expect(f.network).not.toHaveBeenCalled();
    expect(f.user.getIdToken).not.toHaveBeenCalled();
    ready.resolve(f.user);
    expect((await result).status).toBe(200);
    expect(f.network).toHaveBeenCalledOnce();
  });

  it.each(['readiness', 'token'] as const)(
    'fails closed when %s rejects instead of falling back to cookie auth',
    async (stage) => {
      const f = fixture();
      if (stage === 'readiness')
        f.getUser.mockRejectedValueOnce(new Error('fictional readiness error'));
      else f.user.getIdToken.mockRejectedValueOnce(new Error('fictional token error'));
      const result = await f.bound.fetch('/api/v1/sessions', { method: 'POST' });
      expect(result.status).toBe(401);
      expect(await result.json()).toMatchObject({ code: 'SESSION_REAUTH_REQUIRED' });
      expect(f.network).not.toHaveBeenCalled();
      expect(f.bound.getProblem()).toBe('SESSION_REAUTH_REQUIRED');
    },
  );

  it('rejects already aborted Request input before readiness/network without marking sign-in broken', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const input = new Request('https://scribe.cureocity.in/api/v1/clients', {
      signal: controller.signal,
    });
    await expect(f.bound.fetch(input)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
    expect(f.bound.getProblem()).toBeNull();
  });

  it.each(['readiness', 'token'] as const)(
    'aborts promptly while waiting for %s and never dispatches after it resolves',
    async (stage) => {
      const f = fixture();
      const controller = new AbortController();
      const ready = deferred<SessionBoundUser | null>();
      const token = deferred<string>();
      if (stage === 'readiness') f.getUser.mockReturnValueOnce(ready.promise);
      else f.user.getIdToken.mockReturnValueOnce(token.promise);
      const result = f.bound
        .fetch('/api/v1/sessions', { method: 'POST', signal: controller.signal })
        .catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(stage === 'readiness' ? f.getUser : f.user.getIdToken).toHaveBeenCalled(),
      );
      controller.abort('cancelled by caller');
      expect(await result).toMatchObject({ name: 'AbortError' });
      ready.resolve(f.user);
      token.resolve(TOKEN);
      await Promise.resolve();
      await Promise.resolve();
      expect(f.network).not.toHaveBeenCalled();
      expect(f.bound.getProblem()).toBeNull();
    },
  );

  it('honors init signal overrides, including null, without changing caller cancellation semantics', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const input = new Request('https://scribe.cureocity.in/api/v1/clients', {
      signal: controller.signal,
    });
    expect((await f.bound.fetch(input, { signal: null })).status).toBe(200);
    expect(f.network.mock.calls[0]?.[1]?.signal).toBeNull();
  });

  it.each(['changed', 'signed-out'] as const)(
    'rechecks current identity after token wait when %s',
    async (change) => {
      const f = fixture();
      const token = deferred<string>();
      f.user.getIdToken.mockReturnValueOnce(token.promise);
      const result = f.bound.fetch('/api/v1/sessions', { method: 'POST' });
      await vi.waitFor(() => expect(f.user.getIdToken).toHaveBeenCalled());
      f.setUser(change === 'changed' ? { uid: 'other-uid', getIdToken: vi.fn() } : null);
      token.resolve(TOKEN);
      expect((await result).status).toBe(401);
      expect(f.bound.getProblem()).toBe(
        change === 'changed' ? 'SESSION_IDENTITY_MISMATCH' : 'SESSION_REAUTH_REQUIRED',
      );
      expect(f.network).not.toHaveBeenCalled();
    },
  );

  it('blocks a late request when another identity check fails during token acquisition', async () => {
    const f = fixture();
    const token = deferred<string>();
    f.user.getIdToken.mockReturnValueOnce(token.promise);
    const result = f.bound.fetch('/api/v1/clients');
    await vi.waitFor(() => expect(f.user.getIdToken).toHaveBeenCalled());
    f.setUser({ uid: 'other-uid', getIdToken: vi.fn() });
    await f.bound.checkIdentity();
    f.setUser(f.user);
    token.resolve(TOKEN);
    expect((await result).status).toBe(401);
    expect(f.network).not.toHaveBeenCalled();
  });

  it.each([
    ['SESSION_IDENTITY_MISMATCH', 'SESSION_IDENTITY_MISMATCH'],
    ['SESSION_REAUTH_REQUIRED', 'SESSION_REAUTH_REQUIRED'],
    ['OTHER_401', 'SESSION_REAUTH_REQUIRED'],
  ] as const)(
    'preserves the original 401 response body and records %s without replay',
    async (code, problem) => {
      const f = fixture();
      const original = Response.json({ code, error: 'synthetic error' }, { status: 401 });
      f.network.mockResolvedValueOnce(original);
      const result = await f.bound.fetch('/api/v1/sessions', {
        method: 'POST',
        body: 'one attempt',
      });
      expect(result).toBe(original);
      expect(result.bodyUsed).toBe(false);
      expect(await result.json()).toEqual({ code, error: 'synthetic error' });
      expect(f.bound.getProblem()).toBe(problem);
      expect(f.network).toHaveBeenCalledOnce();
      expect((await f.bound.fetch('/api/v1/clients')).status).toBe(401);
      expect(f.network).toHaveBeenCalledOnce();
    },
  );

  it('treats a non-JSON general 401 as reauth-required', async () => {
    const f = fixture();
    f.network.mockResolvedValueOnce(new Response('Unauthorised', { status: 401 }));
    expect(await (await f.bound.fetch('/api/v1/clients')).text()).toBe('Unauthorised');
    expect(f.bound.getProblem()).toBe('SESSION_REAUTH_REQUIRED');
  });

  it('does not mask ordinary capability-denied 403s or treat them as sign-in failure', async () => {
    const f = fixture();
    const denied = Response.json({ code: 'CAPABILITY_DISABLED' }, { status: 403 });
    f.network.mockResolvedValueOnce(denied);
    const result = await f.bound.fetch('/api/v1/sessions', { method: 'POST' });
    expect(result).toBe(denied);
    expect(f.bound.getProblem()).toBeNull();
    expect((await f.bound.fetch('/api/v1/clients')).status).toBe(200);
    expect(f.network).toHaveBeenCalledTimes(2);
  });

  it('keeps network failures distinct from identity failures and never retries writes', async () => {
    const f = fixture();
    const error = new TypeError('fictional network interruption');
    f.network.mockRejectedValueOnce(error);
    await expect(f.bound.fetch('/api/v1/sessions', { method: 'POST' })).rejects.toBe(error);
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.bound.getProblem()).toBeNull();
  });

  it('suppresses late in-flight success after an identity problem is reported', async () => {
    const f = fixture();
    const late = deferred<Response>();
    f.network.mockReturnValueOnce(late.promise);
    const result = f.bound.fetch('/api/v1/clients');
    await vi.waitFor(() => expect(f.network).toHaveBeenCalledOnce());
    f.setUser({ uid: 'other-uid', getIdToken: vi.fn() });
    await f.bound.checkIdentity();
    late.resolve(Response.json({ sensitive: 'fictional stale data' }));
    const response = await result;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'SESSION_IDENTITY_MISMATCH' });
    expect(response.bodyUsed).toBe(true);
  });

  it('notifies once, supports unsubscribe, and keeps the problem sticky even after matching auth returns', async () => {
    const f = fixture();
    const listener = vi.fn();
    const removed = vi.fn();
    const unsubscribe = f.bound.subscribe(removed);
    f.bound.subscribe(listener);
    unsubscribe();
    f.bound.subscribe(() => {
      throw new Error('observer cannot unblock transport');
    });
    f.setUser({ uid: 'other-uid', getIdToken: vi.fn() });
    await expect(f.bound.checkIdentity()).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    f.setUser(f.user);
    await f.bound.checkIdentity();
    const before = f.getUser.mock.calls.length;
    expect((await f.bound.fetch('/api/v1/clients')).status).toBe(401);
    expect(f.getUser).toHaveBeenCalledTimes(before);
    expect(listener).toHaveBeenCalledOnce();
    await f.bound.fetch('/api/v1/auth/session', { method: 'POST' });
    expect(f.network).toHaveBeenCalledOnce();
    expect(f.bound.getProblem()).toBe('SESSION_IDENTITY_MISMATCH');
  });

  it('checkIdentity handles readiness failure without rejecting, fetching or reading tokens', async () => {
    const f = fixture();
    f.getUser.mockRejectedValueOnce(new Error('fictional readiness failure'));
    await expect(f.bound.checkIdentity()).resolves.toBeUndefined();
    expect(f.bound.getProblem()).toBe('SESSION_REAUTH_REQUIRED');
    expect(f.network).not.toHaveBeenCalled();
    expect(f.user.getIdToken).not.toHaveBeenCalled();
  });

  it.each(['readiness', 'token'] as const)(
    'bounds a stalled %s wait to ten seconds and does not dispatch if it resolves later',
    async (stage) => {
      vi.useFakeTimers();
      const f = fixture();
      const ready = deferred<SessionBoundUser | null>();
      const token = deferred<string>();
      if (stage === 'readiness') f.getUser.mockReturnValueOnce(ready.promise);
      else f.user.getIdToken.mockReturnValueOnce(token.promise);
      const result = f.bound.fetch('/api/v1/sessions', { method: 'POST' });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(f.bound.getProblem()).toBeNull();
      expect(f.network).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const response = await result;
      expect(response.status).toBe(401);
      expect(f.bound.getProblem()).toBe('SESSION_REAUTH_REQUIRED');
      expect(vi.getTimerCount()).toBe(0);
      ready.resolve(f.user);
      token.resolve(TOKEN);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.network).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds checkIdentity readiness without rejecting or leaving a timer', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.getUser.mockReturnValueOnce(new Promise(() => undefined));
    const checking = f.bound.checkIdentity();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(checking).resolves.toBeUndefined();
    expect(f.bound.getProblem()).toBe('SESSION_REAUTH_REQUIRED');
    expect(f.network).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans timers on successful readiness/token checks and ordinary rejection', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.bound.checkIdentity();
    await f.bound.fetch('/api/v1/clients');
    expect(vi.getTimerCount()).toBe(0);
    f.user.getIdToken.mockRejectedValueOnce(new Error('fictional token failure'));
    expect((await f.bound.fetch('/api/v1/clients')).status).toBe(401);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans its timeout on cancellation without turning it into a later sign-in failure', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const controller = new AbortController();
    const ready = deferred<SessionBoundUser | null>();
    f.getUser.mockReturnValueOnce(ready.promise);
    const result = f.bound
      .fetch('/api/v1/clients', { signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    ready.reject(new Error('late fictional readiness failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bound.getProblem()).toBeNull();
    expect(f.network).not.toHaveBeenCalled();
  });
});
