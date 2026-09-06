import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  effects: [] as Array<() => (() => void) | void>,
  registerEffects: true,
  push: vi.fn(),
  sockets: [] as Socket[],
  stream: { state: 'idle', error: null, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useMemo: <T>(compute: () => T) => compute(),
  useEffect: (effect: () => (() => void) | void) => {
    if (harness.registerEffects) harness.effects.push(effect);
  },
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
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/lib/audio/use-live-stream', () => ({ useLiveStream: () => harness.stream }));
vi.mock('@/lib/audio/use-wake-lock', () => ({ useWakeLock: () => {} }));
vi.mock('../components/app/GatewayMockBanner', () => ({ GatewayMockBanner: () => null }));
vi.mock('../components/app/TherapyCopilotRail', () => ({ TherapyCopilotRail: () => null }));
vi.mock('../components/app/MindTherapyGuide', () => ({ MindTherapyGuide: () => null }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
import { TherapistLiveSession } from '../components/app/TherapistLiveSession';

class Socket {
  static OPEN = 1;
  OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  // Delay the close event deliberately, as the network is allowed to do.
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor() {
    harness.sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  status(state: string) {
    this.onmessage?.({ data: JSON.stringify({ type: 'status', state }) });
  }
}
type ElementProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean };
function elements(node: ReactNode): Array<ReactElement<ElementProps>> {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child) ? text(child.props.children) : String(child),
    )
    .join('');
}
let sessionStatus: 'SCHEDULED' | 'IN_PROGRESS' = 'IN_PROGRESS';
let autoStart = false;
function render() {
  harness.stateIndex = 0;
  harness.refIndex = 0;
  const view = TherapistLiveSession({
    sessionId: 's-1',
    sessionStatus,
    clientId: 'c-1',
    kind: 'TREATMENT',
    modality: null,
    language: 'en',
    autoStart,
  });
  harness.registerEffects = false;
  return view;
}
function mount() {
  render();
  const cleanups = harness.effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
  return () => cleanups.forEach((cleanup) => cleanup());
}
function click(label: string) {
  const button = elements(render()).find(
    (el) => el.type === 'button' && text(el.props.children) === label,
  );
  expect(button, `Missing action: ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  button!.props.onClick!();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.sockets = [];
  harness.registerEffects = true;
  sessionStatus = 'IN_PROGRESS';
  autoStart = false;
  harness.stream.start.mockResolvedValue(undefined);
  harness.stream.stop.mockResolvedValue(undefined);
  vi.stubGlobal('React', React);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', {
    location: { protocol: 'http:' },
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"token":"fixture-token"}', { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('real TherapistLiveSession attempt lifecycle wiring', () => {
  it('effect cleanup/replay cancels the first auto-start and permits only its replacement', async () => {
    autoStart = true;
    let finishFirst!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const cleanup = mount();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    cleanup();
    // React StrictMode replays setup after cleanup with the same hook refs.
    harness.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    finishFirst(new Response('{"token":"stale"}', { status: 200 }));
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });
  it('late old close/error/status cannot stop or mutate a newer live capture', async () => {
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const first = harness.sockets[0];
    first.open();
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledOnce());
    first.status('listening');
    render();
    first.status('busy');
    click('Try again');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    const second = harness.sockets[1];
    second.open();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledOnce());
    second.status('listening');
    render();
    const stops = harness.stream.stop.mock.calls.length;
    first.onerror?.();
    first.onclose?.();
    first.status('done');
    expect(harness.stream.stop).toHaveBeenCalledTimes(stops);
    expect(text(render())).toContain('End session');
    expect(text(render())).not.toContain('The live connection dropped');
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('unmount while the token is pending aborts it and never creates a socket or microphone', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    unmount();
    expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    finish(new Response('{"token":"late-token"}', { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.sockets).toHaveLength(0);
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  it('unmount during microphone startup cannot subsequently authorize or send gateway start', async () => {
    sessionStatus = 'SCHEDULED';
    let activate!: () => void;
    harness.stream.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          activate = resolve;
        }),
    );
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(activate).toBeDefined());
    unmount();
    activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('a stale startup rejection cannot stop the replacement microphone', async () => {
    let rejectStart!: (error: Error) => void;
    harness.stream.start.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const first = harness.sockets[0];
    first.open();
    render();
    await vi.waitFor(() => expect(rejectStart).toBeDefined());
    first.onerror?.();
    click('Try again');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    const second = harness.sockets[1];
    second.open();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledOnce());
    const stops = harness.stream.stop.mock.calls.length;
    rejectStart(new Error('old microphone failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.stream.stop).toHaveBeenCalledTimes(stops);
    expect(second.close).not.toHaveBeenCalled();
  });
});
