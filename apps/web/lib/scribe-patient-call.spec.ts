import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  callbacks: [] as { deps: readonly unknown[]; value: unknown }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  callbackIndex: 0,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof value === 'function'
            ? (value as (previous: T) => T)(harness.states[index] as T)
            : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useCallback: (value: unknown, deps: readonly unknown[]) => {
    const index = harness.callbackIndex++;
    const previous = harness.callbacks[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      harness.callbacks[index] = { value, deps };
    return harness.callbacks[index].value;
  },
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = harness.effectIndex++;
    const previous = harness.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i]))
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('../components/video/VideoSessionRoom', () => ({ VideoSessionRoom: 'video-session-room' }));
import {
  ScribePatientCall,
  parseScribePatientCallStatus,
  scribeDocumentationLabel,
  type ScribePatientCallStatus,
} from '../components/video/ScribePatientCall';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  requestToken?: (signal: AbortSignal) => Promise<unknown>;
  counterpartLabel?: string;
  onRoom?: (room: unknown) => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.callbackIndex = 0;
  const view = ScribePatientCall({ teleconsultId: 'call-1' });
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function room() {
  return elements(render()).find((item) => String(item.type) === 'video-session-room');
}
function click(label: string) {
  const button = elements(render()).find(
    (item) => item.type === 'button' && text(item.props.children) === label,
  );
  expect(button, `Missing ${label}`).toBeDefined();
  expect(button!.props.disabled).toBeFalsy();
  button!.props.onClick!();
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  render();
}
function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}
function snapshot(overrides: Partial<ScribePatientCallStatus> = {}): ScribePatientCallStatus {
  return {
    id: 'call-1',
    revision: 1,
    linkVersion: 'link-1',
    status: 'open',
    expiresAt: '2026-10-01T00:00:00.000Z',
    patientConsent: 'pending',
    patientConsentAt: null,
    documentationState: 'idle',
    documentationHeartbeatAt: null,
    canJoin: true,
    canDocument: false,
    ...overrides,
  };
}
let surface: EventTarget & {
  location: { hash: string };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};
const request = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.callbacks = [];
  harness.queued = [];
  surface = Object.assign(new EventTarget(), {
    location: { hash: '#token=private-secret' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  vi.stubGlobal('window', surface);
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', request);
  request.mockImplementation(() => response(snapshot()));
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Scribe patient consent and call surface', () => {
  it('verifies a fragment grant via bearer header without leaking it into request URLs', async () => {
    render();
    render();
    await flush();
    expect(request).toHaveBeenCalledWith(
      '/api/v1/public/scribe/teleconsult/call-1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer private-secret' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      }),
    );
    expect(request.mock.calls.every(([url]) => !String(url).includes('private-secret'))).toBe(true);
    expect(text(render())).toContain('Joining the call is not consent');
    expect(text(render())).toContain('outside India');
    expect(room()?.props.counterpartLabel).toBe('your doctor');
  });

  it.each(['pending', 'declined', 'withdrawn'] as const)(
    'permits joining with %s AI consent without granting it implicitly',
    async (patientConsent) => {
      request.mockImplementation(() => response(snapshot({ patientConsent })));
      render();
      render();
      await flush();
      const currentRoom = room();
      expect(currentRoom).toBeDefined();
      request.mockImplementationOnce(() =>
        response({
          ...snapshot({ patientConsent }),
          token: 'livekit-token',
          url: 'wss://video.example.test',
        }),
      );
      await expect(currentRoom!.props.requestToken!(new AbortController().signal)).resolves.toEqual(
        { token: 'livekit-token', url: 'wss://video.example.test' },
      );
      const post = request.mock.calls.find(([, options]) => options.method === 'POST');
      expect(JSON.parse(post![1].body)).toEqual({ token: 'private-secret', action: 'token' });
    },
  );

  it('requires an explicit consent action and confirms the server revision', async () => {
    render();
    render();
    await flush();
    request.mockImplementationOnce(() =>
      response(snapshot({ revision: 2, patientConsent: 'granted', canDocument: true })),
    );
    click('Allow AI documentation');
    expect(text(render())).not.toContain('You allowed AI documentation.');
    expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toMatchObject({
      action: 'consent',
      consent: 'granted',
      expectedRevision: 1,
    });
    await flush();
    expect(text(render())).toContain('You allowed AI documentation.');
    expect(text(render())).toContain('Withdraw AI permission');
    expect(text(render())).toContain('AI documentation has not started');
  });

  it('fails closed and never claims AI is off when polling fails', async () => {
    request.mockImplementationOnce(() =>
      response(
        snapshot({
          patientConsent: 'granted',
          documentationState: 'recording',
          canDocument: true,
          documentationHeartbeatAt: new Date().toISOString(),
        }),
      ),
    );
    render();
    render();
    await flush();
    expect(text(render())).toContain('AI documentation is active');
    request.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(text(render())).toContain('AI documentation status unavailable');
    expect(text(render())).toContain('Do not assume documentation is off');
  });

  it.each(['revoked', 'ended', 'expired'] as const)(
    'removes the room when the server reports %s',
    async (status) => {
      render();
      render();
      await flush();
      expect(room()).toBeDefined();
      request.mockImplementationOnce(() =>
        response(snapshot({ revision: 2, status, canJoin: false })),
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
      expect(room()).toBeUndefined();
      expect(text(render())).toContain('This consultation link is closed');
    },
  );

  it('disconnects when a withdrawal cannot be confirmed and does not report success', async () => {
    request.mockImplementationOnce(() =>
      response(snapshot({ patientConsent: 'granted', canDocument: true })),
    );
    render();
    render();
    await flush();
    request.mockRejectedValueOnce(new Error('offline'));
    click('Withdraw AI permission');
    await flush();
    expect(room()).toBeUndefined();
    expect(text(render())).toContain('Your withdrawal could not be confirmed');
    expect(text(render())).not.toContain('Your choice: no AI documentation.');
  });

  it('stops call inputs immediately and holds a deferred or conflicted withdrawal across still-granted polls', async () => {
    const granted = snapshot({ patientConsent: 'granted', canDocument: true });
    request.mockImplementation(() => response(granted));
    render();
    render();
    await flush();
    const stop = vi.fn();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    room()!.props.onRoom!({
      localParticipant: { trackPublications: new Map([['mic', { track: { stop } }]]) },
      disconnect,
    });
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    click('Withdraw AI permission');
    expect(stop).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(room()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(text(render())).toContain('Your no-AI choice is waiting for confirmation');
    finish(new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 }));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(text(render())).toContain('Your withdrawal could not be confirmed');
    request.mockImplementationOnce(() =>
      response(
        snapshot({ revision: 3, patientConsent: 'withdrawn', documentationState: 'paused' }),
      ),
    );
    click('Retry no-AI choice');
    await flush();
    expect(room()).toBeDefined();
    expect(text(render())).toContain('Your choice: no AI documentation.');
    expect(
      request.mock.calls
        .filter(([, options]) => options.method === 'POST')
        .map(([, options]) => JSON.parse(options.body).action),
    ).toEqual(['consent', 'consent']);
  });

  it('keeps the opt-out retry enabled after failure even when polling is unavailable', async () => {
    request.mockImplementationOnce(() =>
      response(snapshot({ patientConsent: 'granted', canDocument: true })),
    );
    render();
    render();
    await flush();
    request.mockRejectedValue(new Error('offline'));
    click('Withdraw AI permission');
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(text(render())).toContain('Your withdrawal could not be confirmed');
    expect(room()).toBeUndefined();
    click('Retry no-AI choice');
    await flush();
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(2);
  });

  it('does not treat a still-pending server choice as confirmation of a failed decline', async () => {
    render();
    render();
    await flush();
    request.mockRejectedValueOnce(new Error('offline'));
    click('Continue without AI');
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(text(render())).toContain('Your no-AI choice is waiting for confirmation');
    request.mockImplementationOnce(() =>
      response(snapshot({ revision: 2, patientConsent: 'declined', documentationState: 'paused' })),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeDefined();
    expect(text(render())).not.toContain('Your no-AI choice is waiting for confirmation');
  });

  it('does not allow an in-flight call-token response to bypass a new opt-out intent', async () => {
    const granted = snapshot({ patientConsent: 'granted', canDocument: true });
    request.mockImplementation(() => response(granted));
    render();
    render();
    await flush();
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const tokenRequest = room()!.props.requestToken!(new AbortController().signal);
    request.mockRejectedValueOnce(new Error('offline'));
    click('Withdraw AI permission');
    await flush();
    finish(
      new Response(
        JSON.stringify({ ...granted, token: 'late-token', url: 'wss://video.example.test' }),
      ),
    );
    await expect(tokenRequest).rejects.toThrow('room could not be opened');
    expect(room()).toBeUndefined();
  });

  it('only clears a failed opt-out through a newer no-AI status or an explicitly confirmed new opt-in', async () => {
    const granted = snapshot({ patientConsent: 'granted', canDocument: true });
    request.mockImplementation(() => response(granted));
    render();
    render();
    await flush();
    request.mockRejectedValueOnce(new Error('offline'));
    click('Withdraw AI permission');
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    click('Allow AI documentation instead');
    expect(room()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    finish(new Response(JSON.stringify({ ...granted, revision: 3 })));
    await flush();
    expect(room()).toBeDefined();
    expect(text(render())).not.toContain('Your no-AI choice is waiting');
  });

  it('aborts old-link requests and ignores late responses after a link change', async () => {
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    render();
    render();
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    surface.location.hash = '#token=next-secret';
    surface.dispatchEvent(new Event('hashchange'));
    render();
    await flush();
    expect(signal.aborted).toBe(true);
    finish(new Response(JSON.stringify(snapshot({ revision: 99, patientConsent: 'granted' }))));
    await flush();
    expect(text(render())).not.toContain('You allowed AI documentation.');
    expect(request.mock.calls.at(-1)![1].headers).toEqual({ Authorization: 'Bearer next-secret' });
  });

  it('does not request public data when the private fragment is missing', () => {
    surface.location.hash = '';
    render();
    render();
    expect(request).not.toHaveBeenCalled();
    expect(text(render())).toContain('Open the complete private link');
    expect(room()).toBeUndefined();
  });
});

describe('public consultation state validation', () => {
  it('rejects unknown or missing permission values and does not retain identity fields', () => {
    expect(parseScribePatientCallStatus({ ...snapshot(), canJoin: 'yes' })).toBeNull();
    expect(
      parseScribePatientCallStatus({ ...snapshot(), documentationState: 'unknown' }),
    ).toBeNull();
    expect(
      parseScribePatientCallStatus({ ...snapshot(), patientName: 'Private patient' }),
    ).not.toHaveProperty('patientName');
  });

  it('does not show active recording when the heartbeat or documentation grant is stale', () => {
    const status = snapshot({
      patientConsent: 'granted',
      documentationState: 'recording',
      canDocument: true,
      documentationHeartbeatAt: new Date(Date.now() - 20_001).toISOString(),
    });
    expect(scribeDocumentationLabel(status, true)).toBe('AI documentation status unavailable');
    expect(
      scribeDocumentationLabel(
        { ...status, canDocument: false, documentationHeartbeatAt: new Date().toISOString() },
        true,
      ),
    ).toBe('AI documentation status unavailable');
    expect(scribeDocumentationLabel(snapshot(), false)).toBe('AI documentation status unavailable');
  });

  it.each([
    ['preparing', 'Preparing AI documentation'],
    ['draining', 'Finishing captured audio'],
  ] as const)(
    'distinguishes %s from active recording and expires its indicator',
    (documentationState, label) => {
      const status = snapshot({
        documentationState,
        patientConsent: 'granted',
        canDocument: true,
        documentationHeartbeatAt: new Date().toISOString(),
      });
      expect(parseScribePatientCallStatus(status)).not.toBeNull();
      expect(scribeDocumentationLabel(status, true)).toBe(label);
      expect(
        scribeDocumentationLabel(
          { ...status, documentationHeartbeatAt: new Date(Date.now() - 20_001).toISOString() },
          true,
        ),
      ).toBe('AI documentation status unavailable');
    },
  );
});
