import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PatientUser = { getIdToken: () => Promise<string> };
type Effect = () => void | (() => void);

// Exercise the actual page effect and auth lifecycle without a DOM renderer.
// This verifies request options/cancellation, not browser cookie or visual QA.
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as Effect[],
  observer: null as null | ((user: PatientUser | null) => void),
  unsubscribe: vi.fn(),
  auth: {},
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = mocks.states.length;
      mocks.states.push(initial);
      return [initial, (value: unknown) => (mocks.states[index] = value)];
    },
    useEffect(effect: Effect) {
      mocks.effects.push(effect);
    },
  };
});
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, observer: (user: PatientUser | null) => void) => {
    mocks.observer = observer;
    return mocks.unsubscribe;
  },
}));
vi.mock('@/lib/firebase-client', () => ({ getFirebaseAuth: () => mocks.auth }));
vi.mock('@/components/portal/ClientPhoneSignIn', () => ({ default: () => null }));

import ClientCareHomePage from '../app/p/home/page';

let network: ReturnType<typeof vi.fn<typeof fetch>>;
let cleanup: (() => void) | undefined;
let replaceState: ReturnType<typeof vi.fn>;

function mount(search = '') {
  vi.stubGlobal('window', { location: { search }, history: { replaceState } });
  ClientCareHomePage();
  expect(mocks.effects).toHaveLength(1);
  cleanup = mocks.effects[0]() || undefined;
}

function user(token = 'patient-token') {
  return { getIdToken: vi.fn(async () => token) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.effects = [];
  mocks.observer = null;
  cleanup = undefined;
  replaceState = vi.fn();
  network = vi.fn<typeof fetch>(async () => Response.json({ sections: [] }));
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('React', React);
});

afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

describe('patient care-home identity-isolated requests', () => {
  it('loads with only the patient bearer, omitting ambient cookies and preserving no-store/abort', async () => {
    mount();
    const patient = user();
    mocks.observer?.(patient);
    await settle();

    expect(patient.getIdToken).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledExactlyOnceWith('/api/v1/p/home', {
      credentials: 'omit',
      headers: { Authorization: 'Bearer patient-token' },
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(network.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(mocks.states[0]).toEqual({ sections: [] });
  });

  it('refreshes with the same patient bearer and JSON body, then loads with cookies omitted on both requests', async () => {
    mount('?refresh=fictional-share');
    mocks.observer?.(user());
    await settle();

    expect(network).toHaveBeenCalledTimes(2);
    const signal = network.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(network).toHaveBeenNthCalledWith(1, '/api/v1/p/home', {
      method: 'POST',
      credentials: 'omit',
      headers: { Authorization: 'Bearer patient-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId: 'fictional-share' }),
      signal,
    });
    expect(network).toHaveBeenNthCalledWith(2, '/api/v1/p/home', {
      credentials: 'omit',
      headers: { Authorization: 'Bearer patient-token' },
      cache: 'no-store',
      signal,
    });
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/p/home');
    expect(mocks.states[0]).toEqual({ sections: [] });
  });

  it('clears loaded care immediately on sign-out and does not dispatch another request', async () => {
    mount();
    mocks.observer?.(user());
    await settle();
    const signal = network.mock.calls[0]?.[1]?.signal;

    mocks.observer?.(null);

    expect(signal?.aborted).toBe(true);
    expect(mocks.states[0]).toBeNull();
    expect(mocks.states[2]).toBe(true);
    expect(mocks.states[1]).toContain('Sign in with the phone number');
    expect(network).toHaveBeenCalledOnce();
  });

  it('aborts the former patient request and never applies its late response after an account change', async () => {
    const former = deferred<Response>();
    network.mockReturnValueOnce(former.promise);
    mount();
    mocks.observer?.(user('former-patient-token'));
    await settle();
    const formerSignal = network.mock.calls[0]?.[1]?.signal;

    mocks.observer?.(user('current-patient-token'));
    await settle();
    expect(formerSignal?.aborted).toBe(true);
    expect(network.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: 'Bearer current-patient-token',
    });
    expect(network.mock.calls[1]?.[1]?.credentials).toBe('omit');
    expect(mocks.states[0]).toEqual({ sections: [] });

    former.resolve(Response.json({ sections: [{ kind: 'FORMER_PATIENT' }] }));
    await settle();
    expect(mocks.states[0]).toEqual({ sections: [] });
  });

  it('does not dispatch after sign-out while the patient token is still loading', async () => {
    const token = deferred<string>();
    mount();
    mocks.observer?.({ getIdToken: () => token.promise });
    mocks.observer?.(null);
    token.resolve('former-patient-token');
    await settle();

    expect(network).not.toHaveBeenCalled();
    expect(mocks.states[0]).toBeNull();
    expect(mocks.states[2]).toBe(true);
  });

  it('unsubscribes and aborts a refresh on unmount without issuing its follow-up GET', async () => {
    const refresh = deferred<Response>();
    network.mockReturnValueOnce(refresh.promise);
    mount('?refresh=fictional-share');
    mocks.observer?.(user());
    await settle();
    const signal = network.mock.calls[0]?.[1]?.signal;

    cleanup?.();
    cleanup = undefined;
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    refresh.resolve(Response.json({ ok: true }));
    await settle();

    expect(network).toHaveBeenCalledOnce();
    expect(replaceState).not.toHaveBeenCalled();
    expect(mocks.states[0]).toBeNull();
  });
});
