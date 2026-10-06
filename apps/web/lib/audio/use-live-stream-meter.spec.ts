import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  states: [] as Array<{ value: unknown; writes: unknown[] }>,
  tracks: [] as Track[],
  contexts: [] as CaptureContext[],
  worklets: [] as Worklet[],
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
  useEffect: () => {},
}));

import { useLiveStream } from './use-live-stream';

class Track extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
  stopped = false;
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

class Port extends EventTarget {
  onmessage: ((event: MessageEvent<{ type: string; samples: Float32Array }>) => void) | null = null;
  postMessage({ type }: { type: string }) {
    if (type === 'stop') this.acknowledgeStop();
  }
  acknowledgeStop() {
    this.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
  }
}

class Worklet {
  port = new Port();
  constructor() {
    browser.worklets.push(this);
  }
  connect() {}
  disconnect() {}
}

class CaptureContext extends EventTarget {
  state = 'running';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  constructor() {
    super();
    browser.contexts.push(this);
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

const input = () => browser.states[2].value as { inputLevel: number; lastAudioAt: number | null };
const frame = (level: number) =>
  new MessageEvent('message', {
    data: { type: 'frames', samples: new Float32Array(480).fill(level) },
  });

async function startWithFrame(hook: ReturnType<typeof useLiveStream>, level: number) {
  const nextWorklet = browser.worklets.length;
  const started = hook.start();
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  const port = browser.worklets[nextWorklet].port;
  port.onmessage?.(frame(level));
  await started;
  return port;
}

beforeEach(() => {
  browser.states = [];
  browser.tracks = [];
  browser.contexts = [];
  browser.worklets = [];
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(1_000);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const track = new Track();
        browser.tracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      }),
    },
  });
  vi.stubGlobal('AudioContext', CaptureContext);
  vi.stubGlobal('AudioWorkletNode', Worklet);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live microphone telemetry', () => {
  it('publishes real sample amplitude at 10 Hz without dropping audio frames', async () => {
    const onFrame = vi.fn();
    const hook = useLiveStream({ onFrame });
    expect(hook.inputLevel).toBe(0);
    expect(hook.lastAudioAt).toBeNull();
    const port = await startWithFrame(hook, 0.25);
    expect(input()).toEqual({ inputLevel: 0.25, lastAudioAt: 1_000 });
    const published = browser.states[2].writes.length;

    vi.mocked(performance.now).mockReturnValue(50);
    vi.mocked(Date.now).mockReturnValue(1_050);
    port.onmessage?.(frame(0.5));
    expect(browser.states[2].writes).toHaveLength(published);
    expect(onFrame).toHaveBeenCalledTimes(2);

    vi.mocked(performance.now).mockReturnValue(100);
    vi.mocked(Date.now).mockReturnValue(1_100);
    port.onmessage?.(frame(0.75));
    expect(input()).toEqual({ inputLevel: 0.75, lastAudioAt: 1_100 });

    vi.mocked(performance.now).mockReturnValue(200);
    vi.mocked(Date.now).mockReturnValue(1_200);
    port.onmessage?.(frame(0));
    expect(input()).toEqual({ inputLevel: 0, lastAudioAt: 1_200 });
    expect(onFrame).toHaveBeenCalledTimes(4);
    await hook.stop();
  });

  it('clears activity immediately on stop while still delivering queued tail audio', async () => {
    const onFrame = vi.fn();
    const hook = useLiveStream({ onFrame });
    const port = await startWithFrame(hook, 0.5);
    vi.spyOn(port, 'postMessage').mockImplementation(() => {});
    const stopped = hook.stop();
    expect(browser.tracks[0].stopped).toBe(true);
    expect(input()).toEqual({ inputLevel: 0, lastAudioAt: null });

    vi.mocked(performance.now).mockReturnValue(200);
    port.onmessage?.(frame(0.5));
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(input()).toEqual({ inputLevel: 0, lastAudioAt: null });
    port.acknowledgeStop();
    await stopped;
  });

  it.each(['ended', 'mute', 'context suspended'])(
    'clears stale activity when capture is interrupted: %s',
    async (reason) => {
      const interrupted = vi.fn();
      const hook = useLiveStream({ onFrame: vi.fn(), onInterrupted: interrupted });
      await startWithFrame(hook, 0.5);
      const lateFrame = browser.worklets[0].port.onmessage;
      if (reason === 'context suspended') {
        browser.contexts[0].state = 'suspended';
        browser.contexts[0].dispatchEvent(new Event('statechange'));
      } else {
        browser.tracks[0].dispatchEvent(new Event(reason));
      }
      expect(interrupted).toHaveBeenCalledOnce();
      expect(input()).toEqual({ inputLevel: 0, lastAudioAt: null });
      vi.mocked(performance.now).mockReturnValue(200);
      lateFrame?.(frame(0.5));
      expect(input()).toEqual({ inputLevel: 0, lastAudioAt: null });
      await hook.stop();
    },
  );

  it('ignores old capture events after a fresh microphone starts', async () => {
    const hook = useLiveStream({ onFrame: vi.fn() });
    await startWithFrame(hook, 0);
    const oldFrame = browser.worklets[0].port.onmessage;
    await hook.stop();
    await startWithFrame(hook, 0.25);
    oldFrame?.(frame(1));
    browser.contexts[0].dispatchEvent(new Event('statechange'));
    expect(input()).toEqual({ inputLevel: 0.25, lastAudioAt: 1_000 });
    expect(browser.tracks[1].stopped).toBe(false);
    await hook.stop();
  });
});
