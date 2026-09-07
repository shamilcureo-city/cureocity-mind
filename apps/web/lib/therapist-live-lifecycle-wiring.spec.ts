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
  onFrame: (_pcm: Uint8Array) => {},
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
vi.mock('@/lib/audio/use-live-stream', () => ({
  useLiveStream: (opts: { onFrame: (pcm: Uint8Array) => void }) => {
    harness.onFrame = opts.onFrame;
    return harness.stream;
  },
}));
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('real TherapistLiveSession attempt lifecycle wiring', () => {
  async function listening() {
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    socket.status('listening');
    render();
    return socket;
  }
  async function pause(socket: Socket) {
    click('Pause recording');
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    return JSON.parse(socket.send.mock.calls[1][0] as string) as {
      type: string;
      requestId: string;
    };
  }

  it('Start stays in the header before the guide/rails and sends buffered audio only after listening', async () => {
    mount();
    const header = elements(render()).find((el) => el.type === 'header');
    expect(text(header)).toContain('Start session');
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const audio = new Uint8Array([1, 2]);
    harness.onFrame(audio);
    expect(socket.send).toHaveBeenCalledOnce();
    socket.status('listening');
    expect(socket.send).toHaveBeenNthCalledWith(2, audio);
  });

  it('pause waits for matching acknowledgement, sends no stop, blocks new audio, and explicitly reauthorizes resume', async () => {
    const socket = await listening();
    const command = await pause(socket);
    expect(command.type).toBe('pause');
    expect(text(render())).toContain('Microphone off');
    expect(text(render())).not.toContain('Resume recording');
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: crypto.randomUUID() }),
    });
    expect(text(render())).not.toContain('Resume recording');
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: command.requestId }),
    });
    await vi.waitFor(() => expect(text(render())).toContain('Resume recording'));
    harness.onFrame(new Uint8Array([3, 4]));
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
    expect(harness.push).not.toHaveBeenCalled();
    click('Resume recording');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(harness.stream.start).toHaveBeenCalledOnce();
    const replacement = harness.sockets[1];
    replacement.open();
    await vi.waitFor(() => expect(harness.stream.start).toHaveBeenCalledTimes(2));
  });

  it('unsupported old gateway never produces a confirmed pause; End remains explicit', async () => {
    const socket = await listening();
    vi.useFakeTimers();
    click('Pause recording');
    await vi.advanceTimersByTimeAsync(30_001);
    expect(text(render())).toContain('pause not confirmed');
    expect(text(render())).toContain('pause-support update');
    expect(text(render())).not.toContain('Resume recording');
    expect(harness.push).not.toHaveBeenCalled();
    click('End session');
    click('End & save');
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'stop' }));
  });

  it('paused authorization expiry keeps the microphone off until explicit resume', async () => {
    const socket = await listening();
    const command = await pause(socket);
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: command.requestId }),
    });
    await vi.waitFor(() => expect(text(render())).toContain('Resume recording'));
    socket.status('unauthorized');
    socket.onclose?.();
    expect(text(render())).toContain('Resume recording');
    expect(text(render())).toContain('Microphone off');
    expect(harness.stream.start).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('a failed local final-frame flush cannot be retried into a falsely safe pause or resumed microphone', async () => {
    await listening();
    harness.stream.stop.mockRejectedValueOnce(new Error('worklet timeout'));
    click('Pause recording');
    await vi.waitFor(() => expect(text(render())).toContain('final audio frame was not confirmed'));
    expect(text(render())).not.toContain('Resume recording');
    expect(text(render())).not.toContain('Retry pause confirmation');
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });
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
