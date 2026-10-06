import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; writes: unknown[] }>,
  effects: [] as Array<() => (() => void) | void>,
  tracks: [] as Track[],
  contexts: [] as AudioGraph[],
  worklets: [] as Worklet[],
  addModule: null as (() => Promise<void>) | null,
  resume: null as (() => Promise<void>) | null,
  initialContextState: 'running',
  initialMuted: false,
  initialEnabled: true,
}));
vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(value: T) => {
    const slot = { value, writes: [] as T[] };
    browser.states.push(slot);
    return [
      value,
      (next: T) => {
        slot.value = next;
        slot.writes.push(next);
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void) => browser.effects.push(effect),
}));

import { useLiveStream, type LiveStreamOptions } from './use-live-stream';

class Track extends EventTarget {
  readyState = 'live';
  muted = browser.initialMuted;
  enabled = browser.initialEnabled;
  kind = 'audio';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event('mute'));
  }
  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event('unmute'));
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}
class Port extends EventTarget {
  onmessage: ((event: MessageEvent<{ type: string; samples: Float32Array }>) => void) | null = null;
  postMessage = vi.fn(({ type }: { type: string }) => {
    if (type === 'stop')
      this.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
  });
}
class Worklet {
  port = new Port();
  onprocessorerror: ((event: Event) => void) | null = null;
  constructor() {
    browser.worklets.push(this);
  }
  connect = vi.fn();
  disconnect = vi.fn();
}
class AudioGraph extends EventTarget {
  state = browser.initialContextState;
  destination = {};
  audioWorklet = {
    addModule: vi.fn(async () => {
      await browser.addModule?.();
    }),
  };
  constructor() {
    super();
    browser.contexts.push(this);
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  async resume() {
    await browser.resume?.();
    this.state = 'running';
  }
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}
const state = () => browser.states[0].value;
const frame = (level = 0, length = 480, capturedAt = Date.now()) =>
  new MessageEvent('message', {
    data: { type: 'frames', samples: new Float32Array(length).fill(level), capturedAt },
  });
const asStream = (track: Track) =>
  ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  }) as unknown as MediaStream;
function observe(promise: Promise<void>) {
  const settled = vi.fn();
  const result = promise.then(
    () => {
      settled('resolved');
      return { error: null };
    },
    (error: Error) => {
      settled('rejected');
      return { error };
    },
  );
  return { result, settled };
}
function mount(options: Partial<LiveStreamOptions> = {}) {
  const onFrame = vi.fn();
  const onInterrupted = vi.fn();
  const hook = useLiveStream({ onFrame, onInterrupted, waitForMicrophoneFrames: true, ...options });
  const cleanups = browser.effects
    .map((effect) => effect())
    .filter((item): item is () => void => typeof item === 'function');
  return { hook, onFrame, onInterrupted, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}
async function begin(options: Partial<LiveStreamOptions> = {}) {
  const capture = mount(options);
  const pending = observe(capture.hook.start());
  await flush();
  return { ...capture, ...pending };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  browser.states = [];
  browser.effects = [];
  browser.tracks = [];
  browser.contexts = [];
  browser.worklets = [];
  browser.addModule = null;
  browser.resume = null;
  browser.initialContextState = 'running';
  browser.initialMuted = false;
  browser.initialEnabled = true;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const track = new Track();
        browser.tracks.push(track);
        return asStream(track);
      }),
    },
  });
  vi.stubGlobal('AudioContext', AudioGraph);
  vi.stubGlobal('AudioWorkletNode', Worklet);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local microphone startup observes actual frames before claiming readiness', () => {
  it.each([0, 0.2])(
    'waits for a valid frame and accepts amplitude %s without requiring speech',
    async (level) => {
      const capture = await begin({ selectedDeviceId: 'verified-built-in' });
      expect(state()).toBe('preparing');
      expect(capture.settled).not.toHaveBeenCalled();
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({ deviceId: { exact: 'verified-built-in' } }),
      });
      browser.worklets[0].port.onmessage?.(frame(level));
      expect(await capture.result).toEqual({ error: null });
      expect(state()).toBe('streaming');
      expect(capture.onFrame).toHaveBeenCalledOnce();
      expect(capture.onFrame.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
      expect(capture.onFrame.mock.calls[0][0].byteLength).toBeGreaterThan(0);
      if (level === 0)
        expect([...capture.onFrame.mock.calls[0][0]].every((byte) => byte === 0)).toBe(true);
      expect(capture.onInterrupted).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await capture.hook.stop();
    },
  );

  it('does not consider empty frame messages proof that capture started', async () => {
    const capture = await begin();
    browser.worklets[0].port.onmessage?.(frame(0, 0));
    await flush();
    expect(state()).toBe('preparing');
    expect(capture.settled).not.toHaveBeenCalled();
    expect(capture.onFrame).not.toHaveBeenCalled();
    await capture.hook.stop();
    expect((await capture.result).error?.message).toContain('cancelled');
  });

  it.each(['already muted', 'mute event'] as const)(
    'tolerates %s during startup but forwards no muted frames',
    async (condition) => {
      browser.initialMuted = condition === 'already muted';
      const capture = await begin();
      const track = browser.tracks[0];
      if (condition === 'mute event') track.mute();
      browser.worklets[0].port.onmessage?.(frame(0.5));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(track.stop).not.toHaveBeenCalled();
      expect(capture.onInterrupted).not.toHaveBeenCalled();
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(capture.settled).not.toHaveBeenCalled();
      expect(state()).toBe('preparing');
      track.unmute();
      await flush();
      expect(capture.settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      browser.worklets[0].port.onmessage?.(frame());
      expect(await capture.result).toEqual({ error: null });
      expect(capture.onFrame).toHaveBeenCalledOnce();
      await capture.hook.stop();
    },
  );

  it('does not forward disabled startup input or mistake it for silence', async () => {
    browser.initialEnabled = false;
    const capture = await begin();
    browser.worklets[0].port.onmessage?.(frame());
    expect(capture.onFrame).not.toHaveBeenCalled();
    expect(state()).toBe('preparing');
    browser.tracks[0].enabled = true;
    browser.worklets[0].port.onmessage?.(frame());
    expect(capture.onFrame).not.toHaveBeenCalled();
    expect(capture.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    browser.worklets[0].port.onmessage?.(frame());
    expect(await capture.result).toEqual({ error: null });
    expect(capture.onFrame).toHaveBeenCalledOnce();
    await capture.hook.stop();
  });

  it.each(['no frames', 'muted'] as const)(
    'bounds %s at eight seconds and releases every resource',
    async (condition) => {
      browser.initialMuted = condition === 'muted';
      const capture = await begin();
      const lateFrame = browser.worklets[0].port.onmessage;
      await vi.advanceTimersByTimeAsync(7_999);
      expect(capture.settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await capture.result).error?.message).toMatch(
        condition === 'muted' ? /muted/ : /no audio frames/,
      );
      expect(state()).toBe('error');
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      expect(browser.contexts[0].close).toHaveBeenCalled();
      browser.tracks[0].unmute();
      lateFrame?.(frame(0.5));
      await flush();
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(capture.settled).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('starts the readiness deadline after permission is acquired, not while a prompt is pending', async () => {
    const permission = deferred<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(permission.promise);
    const capture = await begin();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(capture.settled).not.toHaveBeenCalled();
    const track = new Track();
    permission.resolve(asStream(track));
    await flush();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(capture.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await capture.result).error?.message).toContain('no audio frames');
    expect(track.stop).toHaveBeenCalled();
  });

  it('rejects queued pre-unmute audio and requires a freshly captured recovery frame', async () => {
    browser.initialMuted = true;
    const capture = await begin();
    const staleFrame = frame(0.5);
    await vi.advanceTimersByTimeAsync(1_000);
    browser.tracks[0].unmute();
    const port = browser.worklets[0].port;
    port.onmessage?.(staleFrame);
    port.onmessage?.(
      new MessageEvent('message', {
        data: { type: 'frames', samples: new Float32Array(480).fill(0.5) },
      }),
    );
    port.onmessage?.(frame(0.5)); // Equal to the recovery time is still stale.
    await flush();
    expect(capture.onFrame).not.toHaveBeenCalled();
    expect(capture.settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    port.onmessage?.(frame());
    expect(await capture.result).toEqual({ error: null });
    expect(capture.onFrame).toHaveBeenCalledOnce();
    await capture.hook.stop();
  });

  it('checks the wall-clock deadline on delivery even when a blocked thread delayed the timeout callback', async () => {
    const capture = await begin();
    vi.setSystemTime(Date.now() + 9_732);
    browser.worklets[0].port.onmessage?.(frame(0.5));
    await flush();
    expect((await capture.result).error?.message).toContain('no audio frames');
    expect(capture.onFrame).not.toHaveBeenCalled();
    expect(browser.tracks[0].stop).toHaveBeenCalled();
    expect(state()).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['ended event', 'ended without event'] as const)(
    'fails closed for a track %s before readiness',
    async (condition) => {
      const capture = await begin();
      const lateFrame = browser.worklets[0].port.onmessage;
      if (condition === 'ended event') browser.tracks[0].end();
      else browser.tracks[0].readyState = 'ended';
      lateFrame?.(frame(0.5));
      await flush();
      expect((await capture.result).error?.message).toMatch(/microphone|capture/i);
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(state()).toBe('error');
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects a supplied track that is already ended before building an audio graph', async () => {
    const track = new Track();
    track.readyState = 'ended';
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(asStream(track));
    const capture = await begin();
    expect((await capture.result).error?.message).toMatch(/microphone|capture/i);
    expect(browser.contexts).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
    expect(capture.onFrame).not.toHaveBeenCalled();
  });

  it('rejects a stream with no audio track instead of showing Recording', async () => {
    const otherTrack = new Track();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getAudioTracks: () => [],
      getTracks: () => [otherTrack],
    } as unknown as MediaStream);
    const capture = await begin();
    expect((await capture.result).error).toBeInstanceOf(Error);
    expect(otherTrack.stop).toHaveBeenCalled();
    expect(browser.contexts).toHaveLength(0);
    expect(state()).toBe('error');
  });

  it.each(['preparing', 'streaming'] as const)(
    'surfaces processor failure while %s and ignores its queued frames',
    async (phase) => {
      const capture = await begin();
      const worklet = browser.worklets[0];
      const lateFrame = worklet.port.onmessage;
      if (phase === 'streaming') {
        lateFrame?.(frame());
        await capture.result;
      }
      worklet.onprocessorerror?.(new Event('processorerror'));
      await flush();
      if (phase === 'preparing')
        expect((await capture.result).error?.message).toContain('audio processor');
      else
        expect(capture.onInterrupted).toHaveBeenCalledWith(
          expect.stringContaining('audio processor'),
        );
      expect(state()).toBe('error');
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      lateFrame?.(frame(0.5));
      expect(capture.onFrame).toHaveBeenCalledTimes(phase === 'streaming' ? 1 : 0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['mute', 'ended'] as const)(
    'keeps established-stream %s fatal and never automatically resumes',
    async (reason) => {
      const capture = await begin();
      const oldFrame = browser.worklets[0].port.onmessage;
      oldFrame?.(frame());
      await capture.result;
      if (reason === 'mute') browser.tracks[0].mute();
      else browser.tracks[0].end();
      expect(capture.onInterrupted).toHaveBeenCalledOnce();
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      browser.tracks[0].unmute();
      oldFrame?.(frame(0.5));
      await vi.advanceTimersByTimeAsync(8_001);
      expect(capture.onFrame).toHaveBeenCalledOnce();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
      expect(state()).toBe('error');
    },
  );
});

describe('legacy microphone startup compatibility outside the Scribe opt-in', () => {
  it.each([false, undefined])(
    'keeps waitForMicrophoneFrames=%s immediate-ready without a new frame deadline',
    async (option) => {
      const capture = await begin({ waitForMicrophoneFrames: option });
      expect(await capture.result).toEqual({ error: null });
      expect(state()).toBe('streaming');
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(8_001);
      expect(browser.tracks[0].stop).not.toHaveBeenCalled();
      expect(capture.onInterrupted).not.toHaveBeenCalled();
      await capture.hook.stop();
    },
  );

  it('keeps a default-mode mute fatal before the first audio frame', async () => {
    const capture = await begin({ waitForMicrophoneFrames: undefined });
    expect(await capture.result).toEqual({ error: null });
    const lateFrame = browser.worklets[0].port.onmessage;
    browser.tracks[0].mute();
    expect(capture.onInterrupted).toHaveBeenCalledOnce();
    expect(browser.tracks[0].stop).toHaveBeenCalled();
    expect(state()).toBe('error');
    browser.tracks[0].unmute();
    lateFrame?.(frame());
    expect(capture.onFrame).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });
});

describe('startup cancellation and stale browser events', () => {
  it.each(['stop', 'unmount', 'ended'] as const)(
    'does not resolve a start cancelled by %s in its first-frame callback',
    async (action) => {
      let stop: Promise<void> | undefined;
      const onFrame = vi.fn(() => {
        if (action === 'stop') stop = capture.hook.stop();
        else if (action === 'unmount') capture.unmount();
        else browser.tracks[0].end();
      });
      const capture = mount({ onFrame });
      const pending = observe(capture.hook.start());
      await flush();
      browser.worklets[0].port.onmessage?.(frame());
      await flush();
      const result = await pending.result;
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toMatch(
        action === 'ended' ? /microphone|capture/i : /cancelled/,
      );
      expect(onFrame).toHaveBeenCalledOnce();
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      await stop;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['stop', 'unmount'] as const)(
    'releases an acquired grant when %s runs between promise delivery and capture ownership',
    async (action) => {
      const permission = deferred<MediaStream>();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(permission.promise);
      const capture = await begin();
      const track = new Track();
      permission.resolve(asStream(track));
      // The hook's request.then is already queued; cancellation runs before its
      // Promise.race await continuation can store the acquired stream.
      const cancelled = Promise.resolve().then(() => {
        if (action === 'stop') return capture.hook.stop();
        return capture.unmount();
      });
      await flush();
      await cancelled;
      expect((await capture.result).error?.message).toContain('cancelled');
      expect(track.stop).toHaveBeenCalled();
      expect(browser.contexts).toHaveLength(0);
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['stop', 'unmount'] as const)(
    'settles on %s while a permission grant is pending and releases a late grant',
    async (action) => {
      const permission = deferred<MediaStream>();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(permission.promise);
      const capture = await begin();
      if (action === 'stop') await capture.hook.stop();
      else capture.unmount();
      await flush();
      expect((await capture.result).error?.message).toContain('cancelled');
      const track = new Track();
      permission.resolve(asStream(track));
      await flush();
      expect(track.stop).toHaveBeenCalled();
      expect(browser.contexts).toHaveLength(0);
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(capture.onInterrupted).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['module', 'resume', 'first frame'] as const)(
    'cancels while awaiting %s without waiting on that browser operation',
    async (stage) => {
      const gate = deferred<void>();
      if (stage === 'module') browser.addModule = () => gate.promise;
      if (stage === 'resume') {
        browser.initialContextState = 'suspended';
        browser.resume = () => gate.promise;
      }
      const capture = await begin();
      const lateFrame = browser.worklets[0]?.port.onmessage;
      const stop = observe(capture.hook.stop());
      await flush();
      expect((await capture.result).error?.message).toContain('cancelled');
      expect(await stop.result).toEqual({ error: null });
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      gate.resolve();
      await flush();
      lateFrame?.(frame(0.5));
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(capture.onInterrupted).not.toHaveBeenCalled();
      expect(state()).toBe('idle');
      if (stage !== 'first frame') expect(browser.worklets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['module', 'resume'] as const)(
    'bounds a hung %s operation after acquiring the microphone',
    async (stage) => {
      const gate = deferred<void>();
      if (stage === 'module') browser.addModule = () => gate.promise;
      else {
        browser.initialContextState = 'suspended';
        browser.resume = () => gate.promise;
      }
      const capture = await begin();
      await vi.advanceTimersByTimeAsync(8_000);
      expect((await capture.result).error?.message).toContain('ready in time');
      expect(browser.tracks[0].stop).toHaveBeenCalled();
      gate.resolve();
      await flush();
      expect(browser.worklets).toHaveLength(0);
      expect(capture.onFrame).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not let a superseded startup, late frame or old timeout stop a fresh capture', async () => {
    const capture = await begin();
    const oldFrame = browser.worklets[0].port.onmessage;
    const oldProcessorError = browser.worklets[0].onprocessorerror;
    const replacement = observe(capture.hook.start());
    await flush();
    expect((await capture.result).error?.message).toContain('cancelled');
    expect(browser.tracks[0].stop).toHaveBeenCalled();
    oldFrame?.(frame(0.5));
    oldProcessorError?.(new Event('processorerror'));
    expect(capture.onFrame).not.toHaveBeenCalled();
    browser.worklets[1].port.onmessage?.(frame());
    expect(await replacement.result).toEqual({ error: null });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(browser.tracks[1].stop).not.toHaveBeenCalled();
    expect(capture.onInterrupted).not.toHaveBeenCalled();
    expect(capture.onFrame).toHaveBeenCalledOnce();
    expect(state()).toBe('streaming');
    await capture.hook.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
