import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Effect = () => void | (() => void);
type HookSlot =
  | { kind: 'state'; value: unknown }
  | { kind: 'ref'; value: { current: unknown } }
  | { kind: 'effect'; run: Effect; dependencies?: readonly unknown[]; cleanup?: () => void };

// A small deterministic hook lifecycle harness: exercises the actual provider
// and transport without a DOM renderer. It deliberately does not claim DOM QA.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as HookSlot[],
  pending: new Set<number>(),
}));
const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  ready: vi.fn(),
  observe: vi.fn(),
  signOut: vi.fn(),
  observer: null as null | (() => void),
  user: null as null | { uid: string; getIdToken: () => Promise<string> },
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      hooks.slots[index] ??= {
        kind: 'state',
        value: typeof initial === 'function' ? initial() : initial,
      };
      const slot = hooks.slots[index];
      if (slot.kind !== 'state') throw new Error('Hook order changed');
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { kind: 'ref', value: { current: initial } };
      const slot = hooks.slots[index];
      if (slot.kind !== 'ref') throw new Error('Hook order changed');
      return slot.value;
    },
    useEffect(run: Effect, dependencies?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (previous && previous.kind !== 'effect') throw new Error('Hook order changed');
      const changed =
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]));
      if (changed) {
        hooks.slots[index] = {
          kind: 'effect',
          run,
          dependencies,
          cleanup: previous?.cleanup,
        };
        hooks.pending.add(index);
      }
    },
  };
});
vi.mock('@/lib/firebase-therapist', () => ({
  isFirebaseConfigured: mocks.configured,
  getFirebaseAuth: () => ({
    authStateReady: mocks.ready,
    get currentUser() {
      return mocks.user;
    },
  }),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: mocks.observe, signOut: mocks.signOut }));

import { AuthedFetchProvider } from '../components/app/AuthedFetchProvider';

let originalFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let unsubscribe: ReturnType<typeof vi.fn>;
let boundaryKey: string | null;

function render(uid: string | null) {
  hooks.cursor = 0;
  const boundary = AuthedFetchProvider({
    expectedUid: uid,
    children: React.createElement('div', { 'data-protected': uid ?? 'local' }, 'Unsaved draft'),
  });
  // Model React's keyed child reconciliation: a different account remounts its
  // hook state; a same-account auth failure preserves the existing draft tree.
  if (typeof boundary.type !== 'function') throw new Error('Expected keyed session boundary');
  const nextKey = boundary.key;
  if (boundaryKey !== null && boundaryKey !== nextKey) {
    cleanup();
    hooks.slots = [];
    hooks.pending.clear();
  }
  boundaryKey = nextKey;
  hooks.cursor = 0;
  return boundary.type(boundary.props) as React.ReactNode;
}

function flushEffects() {
  for (const index of hooks.pending) {
    const slot = hooks.slots[index];
    if (slot.kind !== 'effect') throw new Error('Expected effect');
    slot.cleanup?.();
    slot.cleanup = slot.run() || undefined;
  }
  hooks.pending.clear();
  boundaryKey = null;
}

function cleanup() {
  for (const slot of hooks.slots) {
    if (slot.kind === 'effect') {
      slot.cleanup?.();
      slot.cleanup = undefined;
    }
  }
}

function containsProtected(node: React.ReactNode): boolean {
  if (Array.isArray(node)) return node.some(containsProtected);
  if (!React.isValidElement<{ children?: React.ReactNode; 'data-protected'?: string }>(node))
    return false;
  return node.props['data-protected'] !== undefined || containsProtected(node.props.children);
}

function containsText(node: React.ReactNode, text: string): boolean {
  if (typeof node === 'string') return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => containsText(child, text));
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return false;
  return containsText(node.props.children, text);
}

async function settle() {
  // Promise-only Firebase mock and guard chains, no wall-clock sleeps.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function user(uid: string) {
  return { uid, getIdToken: vi.fn(async () => `token-${uid}`) };
}

beforeEach(() => {
  vi.resetAllMocks();
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.pending.clear();
  mocks.user = user('account-a');
  mocks.configured.mockReturnValue(true);
  mocks.ready.mockResolvedValue(undefined);
  unsubscribe = vi.fn();
  mocks.observe.mockImplementation((_auth, listener: () => void) => {
    mocks.observer = listener;
    return unsubscribe;
  });
  originalFetch = vi.fn<typeof fetch>(async () => new Response('{}'));
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', {
    fetch: originalFetch,
    location: { origin: 'https://scribe.cureocity.in', assign: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authenticated fetch provider lifecycle', () => {
  it('withholds children until its guard is installed and Firebase readiness completes', async () => {
    let release!: () => void;
    mocks.ready.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    expect(containsProtected(render('account-a'))).toBe(false);
    expect(window.fetch).toBe(originalFetch);
    flushEffects();
    expect(window.fetch).not.toBe(originalFetch);
    expect(containsProtected(render('account-a'))).toBe(false);
    release();
    await settle();
    expect(containsProtected(render('account-a'))).toBe(true);
    await window.fetch('/api/v1/clinic/queue');
    const headers = new Headers(originalFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-cureocity-session-uid')).toBe('account-a');
    expect(headers.get('authorization')).toBe('Bearer token-account-a');
  });

  it('never mounts protected children when Firebase resolves a different account', async () => {
    mocks.user = user('account-b');
    render('account-a');
    flushEffects();
    await settle();
    const tree = render('account-a');
    expect(containsProtected(tree)).toBe(false);
    expect(containsText(tree, 'Your saved sign-ins do not match')).toBe(true);
    expect((await window.fetch('/api/v1/sessions', { method: 'POST' })).status).toBe(401);
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it('supports a cookie-only session with no Firebase currentUser', async () => {
    mocks.user = null;
    render('account-a');
    flushEffects();
    await settle();
    expect(containsProtected(render('account-a'))).toBe(true);
    await window.fetch('/api/v1/clinic/queue');
    const headers = new Headers(originalFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-cureocity-session-uid')).toBe('account-a');
    expect(headers.has('authorization')).toBe(false);
  });

  it('keeps mounted draft children while a later sign-in change pauses requests', async () => {
    render('account-a');
    flushEffects();
    await settle();
    expect(containsProtected(render('account-a'))).toBe(true);
    mocks.user = user('account-b');
    mocks.observer?.();
    await settle();
    const tree = render('account-a');
    expect(containsProtected(tree)).toBe(true);
    expect(containsText(tree, 'Unsaved draft')).toBe(true);
    expect(containsText(tree, 'No failed action will be retried automatically')).toBe(true);
    expect((await window.fetch('/api/v1/sessions', { method: 'POST' })).status).toBe(401);
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it('restores the exact original fetch and unsubscribes on unmount', () => {
    render('account-a');
    flushEffects();
    expect(window.fetch).not.toBe(originalFetch);
    cleanup();
    expect(window.fetch).toBe(originalFetch);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('survives StrictMode setup-cleanup-setup without retaining the first interceptor', async () => {
    render('account-a');
    flushEffects();
    const firstGuard = window.fetch;
    cleanup();
    expect(window.fetch).toBe(originalFetch);
    for (const [index, slot] of hooks.slots.entries()) {
      if (slot.kind === 'effect') hooks.pending.add(index);
    }
    flushEffects();
    expect(window.fetch).not.toBe(firstGuard);
    await settle();
    expect(containsProtected(render('account-a'))).toBe(true);
    await window.fetch('/api/v1/clinic/queue');
    expect(originalFetch).toHaveBeenCalledOnce();
  });

  it('binds a subsequent app/console mount to its own account after cleanup', async () => {
    render('account-a');
    flushEffects();
    await settle();
    cleanup();
    hooks.slots = [];
    hooks.pending.clear();
    mocks.user = user('account-b');
    expect(containsProtected(render('account-b'))).toBe(false);
    flushEffects();
    await settle();
    expect(containsProtected(render('account-b'))).toBe(true);
    await window.fetch('/api/v1/admin/overview');
    const headers = new Headers(originalFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-cureocity-session-uid')).toBe('account-b');
    expect(headers.get('authorization')).toBe('Bearer token-account-b');
  });

  it('withholds new-identity children until an updated page UID has its own ready interceptor', async () => {
    render('account-a');
    flushEffects();
    await settle();
    expect(containsProtected(render('account-a'))).toBe(true);
    const firstKey = boundaryKey;
    mocks.user = user('account-b');
    expect(containsProtected(render('account-b'))).toBe(false);
    expect(boundaryKey).not.toBe(firstKey);
    flushEffects();
    await settle();
    expect(containsProtected(render('account-b'))).toBe(true);
    await window.fetch('/api/v1/clinic/queue');
    const headers = new Headers(originalFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-cureocity-session-uid')).toBe('account-b');
  });

  it('does not carry a previous-account warning into a fresh matching page context', async () => {
    mocks.user = user('account-b');
    render('account-a');
    flushEffects();
    await settle();
    expect(containsText(render('account-a'), 'Your saved sign-ins do not match')).toBe(true);
    expect(containsProtected(render('account-b'))).toBe(false);
    flushEffects();
    await settle();
    const tree = render('account-b');
    expect(containsProtected(tree)).toBe(true);
    expect(containsText(tree, 'Sign in again to continue')).toBe(false);
  });

  it('renders explicit local bypass children without installing a live identity interceptor', () => {
    expect(containsProtected(render(null))).toBe(true);
    flushEffects();
    expect(window.fetch).toBe(originalFetch);
    expect(mocks.ready).not.toHaveBeenCalled();
  });
});
