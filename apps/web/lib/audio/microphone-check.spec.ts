import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMicrophone,
  MicrophoneCheckError,
  type MicrophoneCheckProgress,
} from './microphone-check';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class Track extends EventTarget {
  label = 'MacBook Air Microphone';
  readyState = 'live';
  muted = false;
  enabled = true;
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  getSettings = () => ({ deviceId: 'built-in' });
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event('mute'));
  }
  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event('unmute'));
  }
}

let contexts: FakeContext[];
let worklets: FakeWorklet[];
let moduleLoad: Promise<void>;
let resumeResult: Promise<void> | undefined;
let closeResult: Promise<void> | undefined;
let initialContextState: string;

class FakeContext extends EventTarget {
  state = initialContextState;
  sampleRate = 48_000;
  destination = {};
  source = { connect: vi.fn(), disconnect: vi.fn() };
  audioWorklet = { addModule: vi.fn(() => moduleLoad) };
  createMediaStreamSource = vi.fn(() => this.source);
  resume = vi.fn(async () => {
    await resumeResult;
    this.state = 'running';
  });
  close = vi.fn(async () => {
    await closeResult;
    this.state = 'closed';
  });
  constructor() {
    super();
    contexts.push(this);
  }
}

class FakeWorklet {
  epoch = 0;
  connect = vi.fn();
  disconnect = vi.fn();
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((message: { type: string; epoch?: number }) => {
      if (message.type === 'reset') this.epoch = message.epoch!;
    }),
    close: vi.fn(),
  };
  constructor() {
    worklets.push(this);
  }
  meter(frames: number, level = 0, epoch = this.epoch) {
    this.port.onmessage?.(
      new MessageEvent('message', {
        data: { type: 'meter', epoch, frames, rms: level, peak: level },
      }),
    );
  }
}

let track: Track;
let media: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let controller: AbortController;
let progress: ReturnType<typeof vi.fn<(progress: MicrophoneCheckProgress) => void>>;
const flush = () => vi.advanceTimersByTimeAsync(0);
const begin = (deviceId?: string) =>
  checkMicrophone({ deviceId, signal: controller.signal, onProgress: progress });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  contexts = [];
  worklets = [];
  moduleLoad = Promise.resolve();
  resumeResult = undefined;
  closeResult = undefined;
  initialContextState = 'running';
  track = new Track();
  media = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(media);
  controller = new AbortController();
  progress = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorklet);
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local microphone readiness check', () => {
  it.each([0, 0.25])(
    'accepts three seconds of real frames, including silence (level %s)',
    async (level) => {
      const promise = begin('built-in');
      // Permission is requested within the caller's click, without any await first.
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          sampleRate: 48_000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          deviceId: { exact: 'built-in' },
        },
        video: false,
      });
      await flush();
      expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledWith(
        '/microphone-check-worklet.js',
      );
      expect(progress.mock.calls.map(([value]) => value.stage)).toEqual([
        'requesting',
        'loading-processor',
        'starting-context',
        'waiting-input',
      ]);
      await vi.advanceTimersByTimeAsync(3_000);
      worklets[0].meter(144_000, level);
      await expect(promise).resolves.toEqual({
        deviceId: 'built-in',
        label: 'MacBook Air Microphone',
        heardSound: level > 0,
      });
      expect(track.stop).toHaveBeenCalledOnce();
      expect(contexts[0].source.disconnect).toHaveBeenCalledOnce();
      expect(worklets[0].disconnect).toHaveBeenCalledOnce();
      expect(worklets[0].port.onmessage).toBeNull();
      expect(worklets[0].port.close).toHaveBeenCalledOnce();
      expect(contexts[0].state).toBe('closed');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not consider permission or elapsed time alone ready', async () => {
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'no-frames' });
    await flush();
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].state).toBe('closed');
  });

  it('keeps one bounded capture lifetime when processor setup uses most of the time', async () => {
    const pending = deferred<void>();
    moduleLoad = pending.promise;
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await flush();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(progress.mock.calls.at(-1)?.[0].stage).toBe('loading-processor');
    pending.resolve();
    await flush();
    expect(progress.mock.calls.at(-1)?.[0].stage).toBe('waiting-input');
    worklets[0].meter(128);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].state).toBe('closed');
  });

  it('requires stable elapsed time as well as sufficient frames', async () => {
    const promise = begin();
    const settled = vi.fn();
    void promise.then(settled);
    await flush();
    worklets[0].meter(144_000);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    worklets[0].meter(144_128);
    await promise;
    expect(settled).toHaveBeenCalledOnce();
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['NotReadableError', 'unavailable'],
    ['AbortError', 'unavailable'],
  ])('maps %s to %s without exposing raw browser details', async (name, code) => {
    getUserMedia.mockRejectedValue(new DOMException('private browser diagnostics', name));
    await expect(begin()).rejects.toMatchObject({ name: 'MicrophoneCheckError', code });
    expect(contexts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles synchronous permission failures', async () => {
    getUserMedia.mockImplementation(() => {
      throw new DOMException('', 'NotAllowedError');
    });
    await expect(begin()).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('stops every acquired track when no audio track exists', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [] });
    await expect(begin()).rejects.toMatchObject({ code: 'missing' });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rejects already-ended tracks before creating a context', async () => {
    track.readyState = 'ended';
    await expect(begin()).rejects.toMatchObject({ code: 'ended' });
    expect(contexts).toHaveLength(0);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('stops immediately on a genuine ended event and ignores late frames', async () => {
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'ended' });
    await flush();
    const lateMessage = worklets[0].port.onmessage!;
    track.end();
    expect(track.stop).toHaveBeenCalledOnce();
    const progressCount = progress.mock.calls.length;
    lateMessage(
      new MessageEvent('message', {
        data: { type: 'meter', epoch: 1, frames: 200_000, rms: 1, peak: 1 },
      }),
    );
    await rejected;
    expect(progress).toHaveBeenCalledTimes(progressCount);
    expect(contexts[0].state).toBe('closed');
  });

  it('allows an initial temporary mute to recover without using muted frames', async () => {
    track.muted = true;
    const promise = begin();
    await flush();
    expect(contexts[0].source.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    track.unmute();
    expect(contexts[0].source.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_000);
    worklets[0].meter(144_000, 0);
    await expect(promise).resolves.toMatchObject({ heardSound: false });
  });

  it('resets stability after a mute, disconnects input, and ignores queued old-epoch frames', async () => {
    const promise = begin();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    worklets[0].meter(96_000, 0.2);
    const oldEpoch = worklets[0].epoch;
    track.mute();
    expect(contexts[0].source.disconnect).toHaveBeenCalledOnce();
    track.unmute();
    worklets[0].meter(999_999, 0.2, oldEpoch);
    await vi.advanceTimersByTimeAsync(3_000);
    worklets[0].meter(144_000, 0.2);
    await expect(promise).resolves.toMatchObject({ heardSound: true });
    expect(progress.mock.calls.at(-1)?.[0].frames).toBe(240_000);
  });

  it('reports a permanently muted microphone and releases it at eight seconds', async () => {
    track.muted = true;
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'muted' });
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('reports a partial-frame timeout instead of treating a few frames as ready', async () => {
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await flush();
    worklets[0].meter(128);
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
  });

  it('honors the worklet safety limit without waiting for the main timer', async () => {
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'no-frames' });
    await flush();
    worklets[0].port.onmessage?.(new MessageEvent('message', { data: { type: 'limit' } }));
    expect(track.stop).toHaveBeenCalledOnce();
    await rejected;
  });

  it('does not request permission for an already-aborted check', async () => {
    controller.abort();
    await expect(begin()).rejects.toMatchObject({ code: 'cancelled' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('handles abort from the requesting callback before requesting permission', async () => {
    progress.mockImplementation(() => controller.abort());
    await expect(begin()).rejects.toMatchObject({ code: 'cancelled' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('handles abort from the acquired callback before creating an audio context', async () => {
    progress.mockImplementation((value) => {
      if (value.stage === 'loading-processor') controller.abort();
    });
    await expect(begin()).rejects.toMatchObject({ code: 'cancelled' });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(0);
    expect(worklets).toHaveLength(0);
  });

  it.each(['abort', 'permission timeout'])(
    'stops late-granted tracks after %s, without starting any graph',
    async (reason) => {
      const pending = deferred<MediaStream>();
      getUserMedia.mockReturnValue(pending.promise);
      const promise = begin();
      const rejected = expect(promise).rejects.toMatchObject({
        code: reason === 'abort' ? 'cancelled' : 'timeout',
      });
      if (reason === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      pending.resolve(media);
      await flush();
      expect(track.stop).toHaveBeenCalledOnce();
      expect(contexts).toHaveLength(0);
    },
  );

  it.each(['abort', 'check timeout'])(
    'releases tracks while a module load is pending after %s',
    async (reason) => {
      const pending = deferred<void>();
      moduleLoad = pending.promise;
      const promise = begin();
      const rejected = expect(promise).rejects.toMatchObject({
        code: reason === 'abort' ? 'cancelled' : 'setup-timeout',
      });
      await flush();
      if (reason === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(8_000);
      await rejected;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(contexts[0].state).toBe('closed');
      pending.resolve();
      await flush();
      expect(worklets).toHaveLength(0);
      expect(contexts[0].resume).not.toHaveBeenCalled();
    },
  );

  it('reports stalled context startup as setup timeout rather than missing microphone frames', async () => {
    initialContextState = 'suspended';
    const pending = deferred<void>();
    resumeResult = pending.promise;
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({
      code: 'setup-timeout',
      message: 'The browser audio context did not become ready in time.',
    });
    await flush();
    expect(progress.mock.calls.at(-1)?.[0].stage).toBe('starting-context');
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].state).toBe('closed');
    pending.resolve();
    await flush();
    expect(worklets).toHaveLength(0);
    expect(contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
  });

  it.each(['starting-context', 'waiting-input'] as const)(
    'cleans up cancellation from the %s progress callback without connecting input',
    async (stage) => {
      progress.mockImplementation((value) => {
        if (value.stage === stage) controller.abort();
      });
      await expect(begin()).rejects.toMatchObject({ code: 'cancelled' });
      expect(track.stop).toHaveBeenCalledOnce();
      expect(contexts[0].source.connect).not.toHaveBeenCalled();
      expect(contexts[0].state).toBe('closed');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not connect a graph after cancellation during context resume', async () => {
    initialContextState = 'suspended';
    const pending = deferred<void>();
    resumeResult = pending.promise;
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    await flush();
    controller.abort();
    await rejected;
    pending.resolve();
    await flush();
    expect(worklets).toHaveLength(0);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('releases a microphone even if context close hangs indefinitely', async () => {
    closeResult = new Promise(() => {});
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    await flush();
    controller.abort();
    expect(track.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['processor', 'context'])(
    'releases the microphone after a %s failure',
    async (source) => {
      const promise = begin();
      const rejected = expect(promise).rejects.toMatchObject({ code: 'unavailable' });
      await flush();
      if (source === 'processor') worklets[0].onprocessorerror?.();
      else {
        contexts[0].state = 'suspended';
        contexts[0].dispatchEvent(new Event('statechange'));
      }
      await rejected;
      expect(track.stop).toHaveBeenCalledOnce();
    },
  );

  it('releases tracks if loading the worklet fails', async () => {
    moduleLoad = Promise.reject(new Error('load failed'));
    await expect(begin()).rejects.toMatchObject({ code: 'unavailable' });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].state).toBe('closed');
  });

  it('cancels when the page becomes hidden', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    const promise = begin();
    const rejected = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    await flush();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await rejected;
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('never starts a check in a hidden page', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'hidden' }));
    await expect(begin()).rejects.toMatchObject({ code: 'cancelled' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports missing browser capabilities before requesting permission', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined);
    await expect(begin()).rejects.toBeInstanceOf(MicrophoneCheckError);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe('local-only microphone check worklet', () => {
  const loadProcessor = () => {
    let Processor!: new () => {
      port: {
        onmessage: (event: { data: unknown }) => void;
        postMessage: ReturnType<typeof vi.fn>;
      };
      process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
    };
    class Base {
      port = { onmessage: () => {}, postMessage: vi.fn() };
    }
    runInNewContext(
      readFileSync(new URL('../../public/microphone-check-worklet.js', import.meta.url), 'utf8'),
      {
        AudioWorkletProcessor: Base,
        sampleRate: 48_000,
        registerProcessor: (name: string, implementation: typeof Processor) => {
          expect(name).toBe('cureocity-microphone-check');
          Processor = implementation;
        },
      },
    );
    return new Processor();
  };

  it('posts only scalar metadata, includes silent frames, and zeros output', () => {
    const processor = loadProcessor();
    processor.port.onmessage({ data: { type: 'reset', epoch: 9 } });
    const output = new Float32Array(128).fill(1);
    for (let index = 0; index < 19; index++) {
      expect(processor.process([[new Float32Array(128)]], [[output]])).toBe(true);
    }
    expect(output.every((value) => value === 0)).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'meter',
      epoch: 9,
      frames: 2_432,
      rms: 0,
      peak: 0,
    });
    expect(
      Object.values(processor.port.postMessage.mock.calls[0][0]).every(
        (value) => typeof value === 'string' || typeof value === 'number',
      ),
    ).toBe(true);
  });

  it('aggregates signal energy across every block without leaking sample arrays', () => {
    const processor = loadProcessor();
    for (let index = 0; index < 19; index++) {
      processor.process(
        [[new Float32Array(128).fill(index === 0 ? 0.5 : 0)]],
        [[new Float32Array(128)]],
      );
    }
    expect(processor.port.postMessage.mock.calls[0][0]).toMatchObject({ peak: 0.5, frames: 2_432 });
    expect(processor.port.postMessage.mock.calls[0][0].rms).toBeCloseTo(Math.sqrt(0.25 / 19));
  });

  it('stops at eight seconds of rendered output even without an input device', () => {
    const processor = loadProcessor();
    for (let index = 0; index < 2_999; index++) {
      expect(processor.process([], [[new Float32Array(128)]])).toBe(true);
    }
    expect(processor.process([], [[new Float32Array(128)]])).toBe(false);
    expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'limit' });
  });

  it('does not restart its safety deadline when resetting a muted input', () => {
    const processor = loadProcessor();
    for (let index = 0; index < 2_999; index++) processor.process([], [[new Float32Array(128)]]);
    processor.port.onmessage({ data: { type: 'reset', epoch: 2 } });
    expect(processor.process([], [[new Float32Array(128)]])).toBe(false);
  });

  it('stops processing on explicit cleanup and still silences the output', () => {
    const processor = loadProcessor();
    processor.port.onmessage({ data: { type: 'stop' } });
    const output = new Float32Array(128).fill(1);
    expect(processor.process([[new Float32Array(128).fill(1)]], [[output]])).toBe(false);
    expect(output.every((value) => value === 0)).toBe(true);
    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });
});
