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
  devices: vi.fn(),
  connect: vi.fn(),
  publish: vi.fn(),
  disconnect: vi.fn(),
  removeListeners: vi.fn(),
  remoteTracks: [] as {
    kind: string;
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T) => {
        harness.states[index] = value;
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
vi.mock('livekit-client', () => ({
  ConnectionState: {
    Reconnecting: 'reconnecting',
    Connected: 'connected',
    Disconnected: 'disconnected',
  },
  Track: { Kind: { Video: 'video', Audio: 'audio' } },
  RoomEvent: {
    TrackSubscribed: 'track',
    TrackUnsubscribed: 'untrack',
    ParticipantConnected: 'joined',
    ParticipantDisconnected: 'left',
    ConnectionStateChanged: 'connection',
  },
  createLocalTracks: harness.devices,
  Room: class {
    remoteParticipants = new Map(
      harness.remoteTracks.length
        ? [
            [
              'other',
              {
                trackPublications: new Map(
                  harness.remoteTracks.map((track, index) => [index, { track }]),
                ),
              },
            ],
          ]
        : [],
    );
    localParticipant = {
      trackPublications: new Map(),
      publishTrack: async (track: { kind: string }) => {
        await harness.publish(track);
        this.localParticipant.trackPublications.set(track.kind, { track });
      },
    };
    connect = harness.connect;
    disconnect = harness.disconnect;
    removeAllListeners = harness.removeListeners;
    on() {
      return this;
    }
  },
}));
import { VideoSessionRoom } from '../components/video/VideoSessionRoom';

type Props = { children?: ReactNode; onClick?: () => void };
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
const defaults = {
  tokenEndpoint: '/api/v1/legacy/video-token',
  counterpartLabel: 'your therapist',
  leaveHref: '/app',
};
let overrides: Partial<Parameters<typeof VideoSessionRoom>[0]>;
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = harness.callbackIndex = 0;
  const view = VideoSessionRoom({ ...defaults, ...overrides });
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function join() {
  elements(render()).find((item) => item.type === 'button')!.props.onClick!();
}
function unmount() {
  harness.effects.forEach((effect) => effect.cleanup?.());
  harness.effects = [];
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function track() {
  return { kind: 'audio', stop: vi.fn(), detach: vi.fn(), attach: vi.fn() };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const request = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.callbacks = [];
  harness.queued = [];
  overrides = {};
  harness.remoteTracks = [];
  harness.devices.mockResolvedValue([track()]);
  harness.connect.mockResolvedValue(undefined);
  harness.publish.mockResolvedValue(undefined);
  harness.disconnect.mockResolvedValue(undefined);
  request.mockResolvedValue(
    new Response(JSON.stringify({ token: 'jwt', url: 'wss://video.example.test' })),
  );
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('React', React);
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('shared video room lifecycle and backward compatibility', () => {
  it('retains therapist labels and the legacy POST transport by default', async () => {
    expect(text(render())).toContain('Your video session');
    expect(text(render())).toContain('Join session');
    join();
    await flush();
    expect(request).toHaveBeenCalledWith(
      defaults.tokenEndpoint,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect(harness.connect).toHaveBeenCalledWith('wss://video.example.test', 'jwt');
  });

  it('supports Scribe labels and an explicit secure token callback', async () => {
    const requestToken = vi
      .fn()
      .mockResolvedValue({ token: 'scribe-jwt', url: 'wss://scribe.example.test' });
    overrides = {
      requestToken,
      title: 'Your video consultation',
      joinLabel: 'Join consultation',
      leaveLabel: 'Leave consultation',
    };
    expect(text(render())).toContain('Your video consultation');
    expect(text(render())).toContain('Join consultation');
    join();
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(requestToken).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(harness.connect).toHaveBeenCalledWith('wss://scribe.example.test', 'scribe-jwt');
  });

  it('stops devices whose permission request resolves after unmount', async () => {
    const devices = deferred<ReturnType<typeof track>[]>();
    const audio = track();
    harness.devices.mockReturnValueOnce(devices.promise);
    join();
    await flush();
    expect(harness.devices).toHaveBeenCalledOnce();
    unmount();
    devices.resolve([audio]);
    await flush();
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(harness.connect).not.toHaveBeenCalled();
  });

  it('stops captured devices and disconnects when room connection fails', async () => {
    const audio = track();
    harness.devices.mockResolvedValueOnce([audio]);
    harness.connect.mockRejectedValueOnce(new Error('Could not connect'));
    join();
    await flush();
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(text(render())).toContain('Could not connect');
  });

  it('aborts pending token requests and never acquires devices after unmount', async () => {
    const pending = deferred<{ token: string; url: string }>();
    const requestToken = vi.fn((_signal: AbortSignal) => pending.promise);
    overrides = { requestToken };
    join();
    const signal = requestToken.mock.calls[0]?.[0] as AbortSignal | undefined;
    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve({ token: 'late-jwt', url: 'wss://late.example.test' });
    await flush();
    expect(harness.devices).not.toHaveBeenCalled();
  });

  it('uses the latest parent onRoom callback after an asynchronous join', async () => {
    const devices = deferred<ReturnType<typeof track>[]>();
    const previous = vi.fn();
    const latest = vi.fn();
    overrides = { onRoom: previous };
    harness.devices.mockReturnValueOnce(devices.promise);
    join();
    await flush();
    overrides = { onRoom: latest };
    render();
    devices.resolve([track()]);
    await flush();
    expect(previous.mock.calls.some(([room]) => room !== null)).toBe(false);
    expect(latest.mock.calls.some(([room]) => room !== null)).toBe(true);
    unmount();
    expect(latest).toHaveBeenLastCalledWith(null);
  });

  it('reattaches published and subscribed tracks after the media frame mounts', async () => {
    const camera = { ...track(), kind: 'video' };
    const remoteAudio = track();
    const remoteVideo = { ...track(), kind: 'video' };
    harness.devices.mockResolvedValueOnce([camera]);
    harness.remoteTracks = [remoteAudio, remoteVideo];
    join();
    await flush();
    expect(camera.attach).not.toHaveBeenCalled();
    const localElement = { role: 'local-video' };
    const remoteVideoElement = { role: 'remote-video' };
    const remoteAudioElement = { role: 'remote-audio' };
    harness.refs[1].current = localElement;
    harness.refs[2].current = remoteVideoElement;
    harness.refs[3].current = remoteAudioElement;
    render();
    expect(camera.attach).toHaveBeenCalledWith(localElement);
    expect(remoteVideo.attach).toHaveBeenCalledWith(remoteVideoElement);
    expect(remoteAudio.attach).toHaveBeenCalledWith(remoteAudioElement);
    unmount();
    expect(harness.removeListeners).toHaveBeenCalledOnce();
    expect(remoteAudio.detach).toHaveBeenCalledOnce();
    expect(remoteVideo.detach).toHaveBeenCalledOnce();
    expect(remoteAudio.stop).not.toHaveBeenCalled();
  });
});
