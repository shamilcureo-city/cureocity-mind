import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type {
  ScribeTeleconsultDocumentationState,
  ScribeTeleconsultManagement,
} from './scribe-teleconsult-contracts';

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
  audio: {
    ready: true,
    localAudioReady: true,
    remoteAudioReady: true,
    stream: {} as MediaStream,
    error: null as string | null,
    resume: vi.fn(),
    onRoom: vi.fn(),
  },
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
vi.mock('./audio/use-scribe-call-audio', () => ({ useScribeCallAudio: () => harness.audio }));
vi.mock('../components/app/DoctorLiveEncounter', () => ({
  DoctorLiveEncounter: 'doctor-live-encounter',
}));
vi.mock('../components/app/ScribeTeleconsultSetup', () => ({
  ScribeTeleconsultSetup: 'scribe-teleconsult-setup',
}));
vi.mock('../components/video/VideoSessionRoom', () => ({ VideoSessionRoom: 'video-session-room' }));
import { ScribeTeleconsultShell } from '../components/app/ScribeTeleconsultShell';

type Capture = {
  ready: boolean;
  unavailableReason: string | null;
  beforeStart: () => Promise<void>;
  onStateChange: (state: ScribeTeleconsultDocumentationState, busy: boolean) => void;
};
type Props = {
  children?: ReactNode;
  room?: ReactNode;
  teleconsult?: Capture;
  autoStart?: boolean;
  doctorConfirmed?: boolean;
  onConfirm?: (value: boolean) => void;
  onEnd?: () => void;
  captureBusy?: boolean;
  canManage?: boolean;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child)
      ? [child, ...elements(child.props.children), ...elements(child.props.room)]
      : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.callbackIndex = 0;
  const view = ScribeTeleconsultShell({
    sessionId: 'session-1',
    clientId: 'patient-1',
    patient: { name: 'Fictional patient', age: 40 },
    specialty: 'General medicine',
    ...renderOverrides,
  });
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function room() {
  return elements(render()).find((item) => String(item.type) === 'video-session-room');
}
function setup() {
  return elements(render()).find((item) => String(item.type) === 'scribe-teleconsult-setup')!.props;
}
function capture() {
  return elements(render()).find((item) => String(item.type) === 'doctor-live-encounter')!.props
    .teleconsult!;
}
async function flush() {
  await settle();
  render();
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function unmount() {
  harness.effects.forEach((effect) => effect.cleanup?.());
  harness.effects = [];
}
function response(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}
function snapshot(
  overrides: Partial<ScribeTeleconsultManagement> = {},
): ScribeTeleconsultManagement {
  return {
    id: 'call-1',
    revision: 1,
    linkVersion: 'link-1',
    status: 'open',
    expiresAt: '2026-10-01T00:00:00Z',
    patientConsent: 'granted',
    patientConsentAt: new Date().toISOString(),
    documentationState: 'idle',
    documentationHeartbeatAt: null,
    canJoin: true,
    canDocument: true,
    ...overrides,
  };
}
let current: ScribeTeleconsultManagement;
let renderOverrides: { sessionClosed?: boolean };
let surface: EventTarget & { confirm: ReturnType<typeof vi.fn> };
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
  harness.audio.ready = true;
  harness.audio.error = null;
  harness.audio.resume.mockResolvedValue(undefined);
  current = snapshot();
  renderOverrides = {};
  surface = Object.assign(new EventTarget(), { confirm: vi.fn(() => true) });
  vi.stubGlobal('window', surface);
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', request);
  request.mockImplementation((_url: string, options: RequestInit = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(String(options.body));
      if (body.action === 'documentation')
        current = {
          ...current,
          revision: current.revision + 1,
          documentationState: body.state,
          documentationHeartbeatAt: ['preparing', 'recording', 'draining'].includes(body.state)
            ? new Date().toISOString()
            : null,
        };
    }
    return response({ record: current, configured: true });
  });
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('doctor teleconsult shell behavior', () => {
  it('does not auto-start capture and requires the doctor consent explanation', async () => {
    render();
    await flush();
    const encounter = elements(render()).find(
      (item) => String(item.type) === 'doctor-live-encounter',
    )!;
    expect(encounter.props.autoStart).toBe(false);
    expect(capture().ready).toBe(false);
    expect(capture().unavailableReason).toContain('explained AI documentation');
    setup().onConfirm!(true);
    render();
    expect(capture().ready).toBe(true);
    expect(request.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
  });

  it('resumes the mixer and obtains server authorization before capture can start', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    await capture().beforeStart();
    await flush();
    expect(harness.audio.resume).toHaveBeenCalledOnce();
    const posts = request.mock.calls.filter(([, options]) => options.method === 'POST');
    expect(JSON.parse(posts[0]![1].body)).toMatchObject({
      action: 'documentation',
      state: 'preparing',
      confirmedConsent: true,
      expectedRevision: 1,
    });
    expect(harness.audio.resume.mock.invocationCallOrder[0]).toBeLessThan(
      request.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('blocks capture and clears doctor acknowledgement when the patient withdraws', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    expect(capture().ready).toBe(true);
    current = snapshot({
      revision: 2,
      patientConsent: 'withdrawn',
      canDocument: false,
      documentationState: 'paused',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(capture().ready).toBe(false);
    expect(setup().doctorConfirmed).toBe(false);
    expect(capture().unavailableReason).toContain('not agreed');
  });

  it('fails closed on polling failure and permits explicit retry after freshness returns', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    expect(room()).toBeDefined();
    request.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(capture().ready).toBe(false);
    expect(room()).toBeDefined();
    expect(text(render())).toContain('Consent status is unavailable');
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(capture().ready).toBe(true);
    expect(text(render())).not.toContain('Consent status is unavailable');
  });

  it.each([401, 403, 404])('disconnects the room on a definitive GET %i denial', async (status) => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    expect(room()).toBeDefined();
    request.mockImplementationOnce(() => response({ error: 'Access denied' }, status));
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(capture().ready).toBe(false);
  });

  it('disconnects the room when server configuration is disabled', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    expect(room()).toBeDefined();
    request.mockImplementationOnce(() => response({ record: current, configured: false }));
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(capture().ready).toBe(false);
  });

  it.each([401, 403, 404])(
    'disconnects on a non-JSON GET %i denial instead of treating it as a transient failure',
    async (status) => {
      render();
      await flush();
      setup().onConfirm!(true);
      render();
      expect(room()).toBeDefined();
      request.mockImplementationOnce(() =>
        Promise.resolve(
          new Response('<html>Access denied</html>', {
            status,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await flush();
      expect(room()).toBeUndefined();
      expect(capture().ready).toBe(false);
    },
  );

  it('fails closed when a successful status response contains invalid JSON', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    request.mockImplementationOnce(() =>
      Promise.resolve(
        new Response('<html>Unexpected page</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(room()).toBeUndefined();
    expect(capture().ready).toBe(false);
  });

  it('retains an authorized video discussion after the clinical session is closed without mounting capture', async () => {
    renderOverrides = { sessionClosed: true };
    current = snapshot({ documentationState: 'finished', canDocument: false });
    render();
    await flush();
    expect(room()).toBeDefined();
    expect(elements(render()).some((item) => String(item.type) === 'doctor-live-encounter')).toBe(
      false,
    );
    expect(setup().canManage).toBe(false);
    expect(text(render())).toContain('The video discussion can continue until you end it.');
    expect(request.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
  });

  it('aborts an in-flight mutation and does not send a queued documentation change after unmount', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    capture().onStateChange('recording', true);
    render();
    await settle();
    const first = request.mock.calls.find(([, options]) => options.method === 'POST');
    expect(first).toBeDefined();
    const signal = first![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    capture().onStateChange('draining', true);
    render();
    await settle();
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    unmount();
    expect(signal.aborted).toBe(true);
    finish(new Response(JSON.stringify({ record: current, configured: true })));
    await settle();
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });

  it('keeps call management and unload protection active while the encounter reports unsaved work', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    capture().onStateChange('paused', true);
    render();
    expect(setup().captureBusy).toBe(true);
    const event = new Event('beforeunload', { cancelable: true });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    setup().onEnd!();
    await flush();
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    capture().onStateChange('finished', false);
    render();
    await flush();
    const finished = new Event('beforeunload', { cancelable: true });
    surface.dispatchEvent(finished);
    expect(finished.defaultPrevented).toBe(false);
  });

  it('stops active capture readiness if the server pauses documentation without removing consent', async () => {
    render();
    await flush();
    setup().onConfirm!(true);
    render();
    await capture().beforeStart();
    await flush();
    capture().onStateChange('recording', true);
    render();
    await flush();
    expect(capture().ready).toBe(true);
    current = {
      ...current,
      revision: current.revision + 1,
      documentationState: 'paused',
      documentationHeartbeatAt: null,
    };
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(capture().ready).toBe(false);
    expect(capture().unavailableReason).toContain('paused');
  });
});
