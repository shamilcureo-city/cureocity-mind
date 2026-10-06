import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as Array<{ deps?: unknown[]; cleanup?: () => void }>,
  pending: [] as Array<() => void>,
  contexts: [] as AudioGraph[],
  worklets: [] as Worklet[],
  module: null as (() => Promise<void>) | null,
}));
vi.mock('react', () => ({
  useCallback: <T>(fn: T) => fn,
  useRef: <T>(current: T) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current };
    return hooks.slots[index];
  },
  useState: <T>(value: T) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = value;
    return [
      hooks.slots[index],
      (next: T) => {
        hooks.slots[index] = next;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.effects[index];
    if (previous && deps?.every((value, offset) => value === previous.deps?.[offset])) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects[index] = { deps, cleanup: effect() || undefined };
    });
  },
}));

import { useLiveStream, type LiveStreamOptions } from './use-live-stream';
import { cloneExternalAudio, EXTERNAL_AUDIO_INTERRUPTED_EVENT } from './external-live-audio';

class MediaTrack extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
  kind = 'audio';
  copies: MediaTrack[] = [];
  clone = vi.fn(() => {
    const track = new MediaTrack();
    this.copies.push(track);
    return track;
  });
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}
class Stream extends EventTarget {
  constructor(readonly tracks: MediaTrack[]) {
    super();
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}
class Port extends EventTarget {
  onmessage: ((event: MessageEvent<{ type: string; samples: Float32Array }>) => void) | null = null;
  postMessage(message: { type: string }) {
    if (message.type === 'stop')
      this.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
  }
}
class Worklet {
  port = new Port();
  constructor() {
    hooks.worklets.push(this);
  }
  connect() {}
  disconnect() {}
}
class AudioGraph extends EventTarget {
  state = 'running';
  destination = {};
  audioWorklet = {
    addModule: async () => {
      await hooks.module?.();
    },
  };
  constructor() {
    super();
    hooks.contexts.push(this);
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}
function render(options: LiveStreamOptions) {
  hooks.cursor = 0;
  const hook = useLiveStream(options);
  hooks.pending.splice(0).forEach((effect) => effect());
  return hook;
}
const asMedia = (stream: Stream) => stream as unknown as MediaStream;
const frame = () =>
  new MessageEvent('message', {
    data: { type: 'frames', samples: new Float32Array(480).fill(0.2) },
  });
const input = () => {
  const track = new MediaTrack();
  const stream = new Stream([track]);
  return { track, stream };
};
const options = (stream: Stream | null): LiveStreamOptions => ({
  onFrame: vi.fn(),
  onInterrupted: vi.fn(),
  captureSource: 'external',
  waitForMicrophoneFrames: true, // Must not apply standalone warm-up to call-owned audio.
  externalStream: stream ? asMedia(stream) : null,
  externalReady: true,
});

beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.effects = [];
  hooks.pending = [];
  hooks.contexts = [];
  hooks.worklets = [];
  hooks.module = null;
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => asMedia(input().stream)) },
  });
  vi.stubGlobal('MediaStream', Stream);
  vi.stubGlobal('AudioContext', AudioGraph);
  vi.stubGlobal('AudioWorkletNode', Worklet);
});
afterEach(() => {
  hooks.effects.forEach((effect) => effect?.cleanup?.());
  vi.unstubAllGlobals();
});

describe('live external call audio ownership and fail-closed input', () => {
  it('captures only cloned audio and stops only those clones, never the call microphone/camera', async () => {
    const { track, stream } = input();
    const camera = new MediaTrack();
    camera.kind = 'video';
    stream.tracks.push(camera);
    const config = options(stream);
    const hook = render(config);
    await hook.start();
    hooks.worklets[0].port.onmessage?.(frame());
    expect(config.onFrame).toHaveBeenCalledOnce();
    expect(track.clone).toHaveBeenCalledOnce();
    expect(camera.clone).not.toHaveBeenCalled();
    await hook.stop();
    expect(track.copies[0].stop).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it.each(['missing', 'not ready', 'ended', 'muted', 'disabled', 'no audio'] as const)(
    'refuses %s external input without microphone fallback',
    async (condition) => {
      const { track, stream } = input();
      const config = options(condition === 'missing' ? null : stream);
      if (condition === 'not ready') config.externalReady = false;
      if (condition === 'ended') track.readyState = 'ended';
      if (condition === 'muted') track.muted = true;
      if (condition === 'disabled') track.enabled = false;
      if (condition === 'no audio') stream.tracks.splice(0);
      await expect(render(config).start()).rejects.toThrow('Both sides');
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      expect(hooks.contexts).toHaveLength(0);
      expect(track.clone).not.toHaveBeenCalled();
    },
  );

  it('keeps the existing microphone default when external capture was not selected', async () => {
    const hook = render({ onFrame: vi.fn(), selectedDeviceId: 'verified-mic' });
    await hook.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'verified-mic' } }),
    });
    await hook.stop();
    render({ onFrame: vi.fn(), selectedDeviceId: 'newly-verified-mic' });
    // A retained start callback must use the latest preflight selection.
    await hook.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'newly-verified-mic' } }),
    });
    await hook.stop();
  });

  it('interrupts on loss of rendered two-sided readiness and never automatically resumes', async () => {
    const { track, stream } = input();
    const config = options(stream);
    const hook = render(config);
    await hook.start();
    render({ ...config, externalReady: false, externalUnavailableReason: 'Patient muted.' });
    expect(config.onInterrupted).toHaveBeenCalledWith('Patient muted.');
    expect(track.copies[0].stop).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    render(config);
    expect(hooks.worklets).toHaveLength(1);
    await hook.start();
    expect(hooks.worklets).toHaveLength(2);
    await hook.stop();
  });

  it.each([EXTERNAL_AUDIO_INTERRUPTED_EVENT, 'removetrack', 'addtrack'])(
    'stops immediately on mixer/source %s and removes old listeners',
    async (event) => {
      const { track, stream } = input();
      const config = options(stream);
      const hook = render(config);
      await hook.start();
      const oldFrame = hooks.worklets[0].port.onmessage;
      stream.dispatchEvent(new Event(event));
      expect(config.onInterrupted).toHaveBeenCalledOnce();
      expect(track.copies[0].stop).toHaveBeenCalled();
      oldFrame?.(frame());
      expect(config.onFrame).not.toHaveBeenCalled();
      await hook.stop();
      stream.dispatchEvent(new Event(event));
      track.dispatchEvent(new Event('ended'));
      expect(config.onInterrupted).toHaveBeenCalledOnce();
      expect(track.stop).not.toHaveBeenCalled();
    },
  );

  it('interrupts source replacement rather than silently switching microphones', async () => {
    const first = input();
    const config = options(first.stream);
    const hook = render(config);
    await hook.start();
    render({ ...config, externalStream: asMedia(input().stream) });
    expect(config.onInterrupted).toHaveBeenCalledOnce();
    expect(first.track.copies[0].stop).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['original', 'mute'],
    ['original', 'ended'],
    ['clone', 'mute'],
    ['clone', 'ended'],
  ] as const)(
    'keeps %s call-track %s fatal even before the first call frame',
    async (owner, event) => {
      const { track, stream } = input();
      const config = options(stream);
      const hook = render(config);
      // External-call readiness is owned by the call, not local mic warm-up.
      await hook.start();
      const port = hooks.worklets[0].port;
      const lateFrame = port.onmessage;
      const failed = owner === 'original' ? track : track.copies[0];
      if (event === 'mute') failed.muted = true;
      else failed.readyState = 'ended';
      failed.dispatchEvent(new Event(event));
      expect(config.onInterrupted).toHaveBeenCalledOnce();
      expect(track.copies[0].stop).toHaveBeenCalled();
      expect(track.stop).not.toHaveBeenCalled();
      failed.muted = false;
      failed.dispatchEvent(new Event('unmute'));
      lateFrame?.(frame());
      expect(config.onFrame).not.toHaveBeenCalled();
      expect(hooks.worklets).toHaveLength(1);
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      await hook.stop();
    },
  );

  it('detects an original track stopped without an ended event before accepting another frame', async () => {
    const { track, stream } = input();
    const config = options(stream);
    await render(config).start();
    track.stop();
    hooks.worklets[0].port.onmessage?.(frame());
    expect(config.onInterrupted).toHaveBeenCalledOnce();
    expect(config.onFrame).not.toHaveBeenCalled();
    expect(track.copies[0].stop).toHaveBeenCalled();
  });

  it.each(['stop', 'source gap', 'unmount'] as const)(
    'cancels preparing external input on %s and releases late resources without stopping the call',
    async (action) => {
      let resolve!: () => void;
      hooks.module = () =>
        new Promise<void>((done) => {
          resolve = done;
        });
      const { track, stream } = input();
      const config = options(stream);
      const hook = render(config);
      const started = hook.start();
      const rejected = expect(started).rejects.toThrow(
        action === 'source gap' ? 'Call audio changed or was interrupted' : 'cancelled',
      );
      await vi.waitFor(() => expect(resolve).toBeDefined());
      if (action === 'stop') await hook.stop();
      else if (action === 'source gap')
        stream.dispatchEvent(new Event(EXTERNAL_AUDIO_INTERRUPTED_EVENT));
      else hooks.effects.forEach((effect) => effect?.cleanup?.());
      resolve();
      await rejected;
      expect(track.copies[0].stop).toHaveBeenCalled();
      expect(track.stop).not.toHaveBeenCalled();
      expect(hooks.worklets).toHaveLength(0);
      expect(config.onInterrupted).toHaveBeenCalledTimes(action === 'source gap' ? 1 : 0);
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    },
  );

  it('cleans up partial clone failure without stopping any original call tracks', () => {
    const a = new MediaTrack();
    const b = new MediaTrack();
    b.clone.mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    expect(() => cloneExternalAudio(asMedia(new Stream([a, b])))).toThrow('clone failed');
    expect(a.copies[0].stop).toHaveBeenCalledOnce();
    expect(a.stop).not.toHaveBeenCalled();
    expect(b.stop).not.toHaveBeenCalled();
  });
});
