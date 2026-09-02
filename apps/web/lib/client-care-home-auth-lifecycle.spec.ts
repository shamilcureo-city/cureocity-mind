import { describe, expect, it, vi } from 'vitest';
import { createClientCareHomeAuthLifecycle } from './client-care-home-auth-lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('client care-home auth lifecycle', () => {
  it('clears loaded PHI immediately when authentication is lost', async () => {
    let renderedHome: string | null = null;
    const userAHome = deferred<string>();
    const lifecycle = createClientCareHomeAuthLifecycle<string>({
      clearHome: () => {
        renderedHome = null;
      },
      applyHome: (home) => {
        renderedHome = home;
      },
      applyError: vi.fn(),
    });

    lifecycle.transition(() => userAHome.promise);
    userAHome.resolve('user A clinical care');
    await settle();
    expect(renderedHome).toBe('user A clinical care');

    lifecycle.transition(null);

    expect(renderedHome).toBeNull();
  });

  it('never renders a stale user A response after auth changes to user B or null', async () => {
    let renderedHome: string | null = null;
    const userAHome = deferred<string>();
    const userBHome = deferred<string>();
    const applyError = vi.fn();
    const lifecycle = createClientCareHomeAuthLifecycle<string>({
      clearHome: () => {
        renderedHome = null;
      },
      applyHome: (home) => {
        renderedHome = home;
      },
      applyError,
    });

    lifecycle.transition(() => userAHome.promise);
    lifecycle.transition(() => userBHome.promise);
    userAHome.resolve('user A clinical care');
    await settle();
    expect(renderedHome).toBeNull();

    userBHome.resolve('user B clinical care');
    await settle();
    expect(renderedHome).toBe('user B clinical care');

    const staleUserAHome = deferred<string>();
    lifecycle.transition(() => staleUserAHome.promise);
    lifecycle.transition(null);
    staleUserAHome.resolve('user A clinical care after sign-out');
    await settle();

    expect(renderedHome).toBeNull();
    expect(applyError).not.toHaveBeenCalled();
  });
});
