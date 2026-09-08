import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPersistenceQueue } from './persistence-queue';
import { stopWorklet } from './stop-worklet';
import { AUDIO_CONTEXT_CLOSE_TIMEOUT_MS } from './live-stream-cleanup';
import type { PersistedChunk, PersistedSession } from './idb-chunk-store';

const data = vi.hoisted(() => ({
  chunks: new Map<number, PersistedChunk>(),
  cursor: null as PersistedSession | null,
  failInsert: false,
  tracks: [] as Track[],
  worklet: undefined as unknown as Worklet,
  closed: 0,
  effects: [] as Array<() => (() => void) | void>,
  contexts: [] as AudioContextMock[],
  addModule: null as (() => Promise<void> | void) | null,
}));
vi.mock('react', () => ({
  useCallback: <T>(fn: T) => fn,
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(value: T) => [value, vi.fn()],
  useEffect: (effect: () => (() => void) | void) => {
    data.effects.push(effect);
  },
}));
vi.mock('./storage-buckets', () => ({
  requestPersistentStorage: vi.fn(async () => ({ persisted: true })),
}));
vi.mock('./idb-chunk-store', () => ({
  ChunkStore: {
    insert: vi.fn(async (chunk: PersistedChunk) => {
      if (data.failInsert) throw new Error('quota');
      data.chunks.set(chunk.chunkIndex, chunk);
    }),
    remove: vi.fn(async (_id: string, index: number) => {
      data.chunks.delete(index);
    }),
    listForSession: vi.fn(async () => [...data.chunks.values()]),
    incrementAttempts: vi.fn(async (_id: string, index: number, lastHttpStatus?: number) => {
      const chunk = data.chunks.get(index)!;
      chunk.attempts++;
      chunk.lastHttpStatus = lastHttpStatus;
    }),
    resetRetryableAttempts: vi.fn(async () => {
      for (const chunk of data.chunks.values())
        if (
          !chunk.lastHttpStatus ||
          [401, 408, 429].includes(chunk.lastHttpStatus) ||
          chunk.lastHttpStatus >= 500
        )
          chunk.attempts = 0;
    }),
  },
  SessionStore: {
    getCursor: vi.fn(async () => data.cursor),
    saveCursor: vi.fn(async (cursor: PersistedSession) => {
      data.cursor = cursor;
    }),
    clear: vi.fn(async () => {
      data.cursor = null;
    }),
  },
}));

import { ChunkUploader } from './chunk-uploader';
import { useSessionRecorder } from './use-session-recorder';
import { useLiveStream } from './use-live-stream';
import { uploadAudioFile, IncompleteAudioUploadError, AudioFileStorageError } from './upload-file';

const chunk = (index = 0, attempts = 0) => ({
  sessionId: 's-1',
  chunkIndex: index,
  bytes: new Uint8Array([1, 2]),
  mimeType: 'audio/pcm',
  sampleRate: 16000,
  durationMs: 1,
  enqueuedAt: 123,
  attempts,
});
class Track extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class Port extends EventTarget {
  onmessage: (event: { data: { type: string; samples: Float32Array } }) => void = () => {};
  postMessage(message: { type: string }) {
    if (message.type === 'stop')
      this.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
  }
}
class Worklet {
  port = new Port();
  constructor() {
    data.worklet = this;
  }
  connect() {}
  disconnect() {}
}
class AudioContextMock extends EventTarget {
  constructor() {
    super();
    data.contexts.push(this);
  }
  state = 'running';
  destination = {};
  audioWorklet = {
    addModule: vi.fn(async () => {
      await data.addModule?.();
    }),
  };
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  async close() {
    this.state = 'closed';
    data.closed++;
  }
  async resume() {
    this.state = 'running';
  }
  async decodeAudioData() {
    return { duration: 1 };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  data.chunks.clear();
  data.cursor = null;
  data.failInsert = false;
  data.tracks = [];
  data.closed = 0;
  data.effects = [];
  data.contexts = [];
  data.addModule = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const track = new Track();
        data.tracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      }),
    },
  });
  vi.stubGlobal('AudioContext', AudioContextMock);
  vi.stubGlobal('AudioWorkletNode', Worklet);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('real capture/uploader adapters with controlled browser boundaries', () => {
  const hooks = [
    ['live', () => useLiveStream({ onFrame: vi.fn() })],
    ['batch', () => useSessionRecorder({ sessionId: 's-1', source: 'mic' })],
  ] as const;
  for (const [name, makeHook] of hooks) {
    it(`${name}: a retained callback cannot reacquire the microphone after disposal`, async () => {
      const hook = makeHook();
      const cleanup = data.effects.at(-1)!();
      cleanup?.();
      await expect(hook.start()).rejects.toThrow('no longer available');
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    });
    it(`${name}: unmount cancels a pending microphone grant and releases late tracks`, async () => {
      let grant!: (stream: MediaStream) => void;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
        () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      );
      const hook = makeHook();
      const unmount = data.effects.at(-1)!();
      if (!unmount) throw new Error('Missing hook cleanup');
      const started = hook.start();
      const rejected = expect(started).rejects.toThrow('cancelled');
      await vi.waitFor(() => expect(grant).toBeDefined());
      unmount();
      const track = new Track();
      grant({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream);
      await rejected;
      expect(track.stopped).toBe(true);
      expect(data.contexts).toHaveLength(0);
    });

    it(`${name}: a module failure closes the acquired context and microphone`, async () => {
      data.addModule = () => {
        throw new Error('module unavailable');
      };
      await expect(makeHook().start()).rejects.toThrow('module unavailable');
      expect(data.closed).toBe(1);
      expect(data.tracks[0].stopped).toBe(true);
    });

    it(`${name}: an old start rejection cannot stop a newer capture`, async () => {
      let rejectModule!: (error: Error) => void;
      data.addModule = () =>
        new Promise((_resolve, reject) => {
          rejectModule = reject;
        });
      const hook = makeHook();
      const first = hook.start();
      const rejected = expect(first).rejects.toThrow('old module failed');
      await vi.waitFor(() => expect(rejectModule).toBeDefined());
      await hook.stop();
      data.addModule = null;
      await hook.start();
      rejectModule(new Error('old module failed'));
      await rejected;
      expect(data.tracks[0].stopped).toBe(true);
      expect(data.tracks[1].stopped).toBe(false);
      expect(data.contexts[1].state).toBe('running');
      await hook.stop();
    });
  }

  it('batch pause stops input immediately, waits for final frames, and resumes the next chunk', async () => {
    const hook = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await hook.start();
    const firstPort = data.worklet.port;
    firstPort.onmessage({ data: { type: 'frames', samples: new Float32Array(4_800).fill(0.2) } });
    vi.spyOn(firstPort, 'postMessage').mockImplementation(() => {});
    const paused = hook.pause();
    expect(data.tracks[0].stopped).toBe(true);
    expect(data.cursor).toBeNull();
    firstPort.onmessage({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    firstPort.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
    await paused;
    expect(data.cursor?.nextChunkIndex).toBe(1);
    const uploadsBefore = vi.mocked(fetch).mock.calls.length;
    firstPort.onmessage({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    await hook.start();
    expect(data.tracks[1].stopped).toBe(false);
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(480).fill(0.2) },
    });
    await hook.stop();
    expect(data.cursor?.nextChunkIndex).toBe(2);
    expect(vi.mocked(fetch).mock.calls.length).toBe(uploadsBefore + 1);
  });

  it('external capture pauses its cloned track without disconnecting the call', async () => {
    const callTrack = new Track();
    const captureTrack = new Track();
    const external = {
      getAudioTracks: () => [callTrack],
      clone: () => ({ getTracks: () => [captureTrack], getAudioTracks: () => [captureTrack] }),
    } as unknown as MediaStream;
    const hook = useSessionRecorder({
      sessionId: 's-1',
      source: 'external',
      externalStream: external,
    });
    await hook.start();
    await hook.pause();
    expect(callTrack.stopped).toBe(false);
    expect(captureTrack.stopped).toBe(true);
  });

  it('live context suspension is surfaced instead of continuing a false streaming state', async () => {
    const interrupted = vi.fn();
    const hook = useLiveStream({ onFrame: vi.fn(), onInterrupted: interrupted });
    await hook.start();
    data.contexts[0].state = 'suspended';
    data.contexts[0].dispatchEvent(new Event('statechange'));
    expect(interrupted).toHaveBeenCalledWith(expect.stringContaining('interrupted'));
    expect(data.tracks[0].stopped).toBe(true);
  });

  it('batch context suspension stops capture and flushes the captured tail', async () => {
    const hook = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await hook.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    data.contexts[0].state = 'suspended';
    data.contexts[0].dispatchEvent(new Event('statechange'));
    await hook.stop();
    expect(fetch).toHaveBeenCalledOnce();
    expect(data.tracks[0].stopped).toBe(true);
  });

  it('retains a failed final chunk, rejects stop, releases capture and retries exact bytes', async () => {
    const recorder = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await recorder.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    data.failInsert = true;
    await expect(recorder.stop()).rejects.toThrow('quota');
    expect(data.tracks[0].stopped).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    data.failInsert = false;
    await recorder.stop();
    expect(fetch).toHaveBeenCalledOnce();
    expect(data.chunks.size).toBe(0);
    expect(data.cursor?.nextChunkIndex).toBe(1);
  });

  it('releases the microphone before waiting for the last upload acknowledgement', async () => {
    let acknowledge!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const recorder = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await recorder.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    const stopped = recorder.stop();
    await vi.waitFor(() => expect(acknowledge).toBeDefined());
    expect(data.tracks[0].stopped).toBe(true);
    expect(data.chunks.size).toBe(1);
    acknowledge(new Response('{}', { status: 200 }));
    await stopped;
    expect(data.chunks.size).toBe(0);
  });

  it('missing final-frame acknowledgement stays blocked across retry and reload', async () => {
    vi.useFakeTimers();
    const recorder = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await recorder.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    data.worklet.port.postMessage = () => {};
    const failed = expect(recorder.stop()).rejects.toThrow('automatic finalization is blocked');
    await vi.advanceTimersByTimeAsync(2100);
    await failed;
    expect(data.cursor?.captureIntegrityError).toContain('final audio frame');
    expect(data.chunks.size).toBe(0); // Known bytes are uploaded, uncertain tail is not asserted saved.
    await expect(recorder.stop()).rejects.toThrow('automatic finalization is blocked');
    const reloaded = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await expect(reloaded.start()).rejects.toThrow('automatic finalization is blocked');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it('internal navigation cleanup saves the tail on a best-effort basis', async () => {
    const recorder = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    const unmount = data.effects.at(-1)!();
    if (!unmount) throw new Error('Missing hook cleanup');
    await recorder.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    unmount();
    await vi.waitFor(() => expect(data.cursor?.nextChunkIndex).toBe(1));
    expect(data.tracks[0].stopped).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not clear the resume cursor simply because captured parts uploaded', async () => {
    const recorder = useSessionRecorder({ sessionId: 's-1', source: 'mic' });
    await recorder.start();
    data.worklet.port.onmessage({
      data: { type: 'frames', samples: new Float32Array(4800).fill(0.2) },
    });
    await recorder.stop();
    await recorder.drainPending();
    expect(data.cursor?.nextChunkIndex).toBe(1);
  });

  it('manual retry revives an exhausted transient upload, ordinary drains do not', async () => {
    data.chunks.set(0, chunk(0, 6));
    const uploader = new ChunkUploader({ scribeBase: '/api/v1' });
    await uploader.drainSession('s-1');
    expect(fetch).not.toHaveBeenCalled();
    const progress = vi.fn();
    await uploader.drainSession('s-1', progress, true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(data.chunks.size).toBe(0);
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal).toBeDefined();
  });

  it('permanent validation refusal is not falsely counted as uploaded', async () => {
    data.chunks.set(0, chunk());
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 400 }));
    const progress = vi.fn();
    await new ChunkUploader({ scribeBase: '/api/v1' }).drainSession('s-1', progress);
    expect(data.chunks.size).toBe(1);
    expect(progress).toHaveBeenCalledWith(0, 1);
  });

  it('live microphone ending is reported and releases the track', async () => {
    const interrupted = vi.fn();
    const live = useLiveStream({ onFrame: vi.fn(), onInterrupted: interrupted });
    await live.start();
    data.tracks[0].dispatchEvent(new Event('ended'));
    expect(interrupted).toHaveBeenCalledOnce();
    expect(data.tracks[0].stopped).toBe(true);
  });

  it('intentional live stop does not falsely report an interruption', async () => {
    const interrupted = vi.fn();
    const live = useLiveStream({ onFrame: vi.fn(), onInterrupted: interrupted });
    await live.start();
    await live.stop();
    expect(interrupted).not.toHaveBeenCalled();
    expect(data.tracks[0].stopped).toBe(true);
  });

  it('shared Mind/Scribe live stop bounds a hung context close after a real final-frame acknowledgement', async () => {
    vi.useFakeTimers();
    const onFrame = vi.fn();
    const interrupted = vi.fn();
    const live = useLiveStream({ onFrame, onInterrupted: interrupted });
    await live.start();
    const oldContext = data.contexts[0];
    let rejectClose!: (error: Error) => void;
    const close = vi.spyOn(oldContext, 'close').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectClose = reject;
        }),
    );
    const oldPort = data.worklet.port;
    const lateFrame = oldPort.onmessage;
    vi.spyOn(oldPort, 'postMessage').mockImplementation(() => {});
    const stopped = vi.fn();
    const stopping = live.stop().then(stopped);
    expect(data.tracks[0].stopped).toBe(true);
    // The physical mic is off, but the worklet tail must still be delivered in port order.
    lateFrame({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    expect(onFrame).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    oldPort.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
    await vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_CLOSE_TIMEOUT_MS - 1);
    expect(stopped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await live.start();
    rejectClose(new Error('old browser release failed late'));
    oldContext.state = 'suspended';
    oldContext.dispatchEvent(new Event('statechange'));
    lateFrame({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(data.tracks[1].stopped).toBe(false);
    expect(interrupted).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledOnce();
    await live.stop();
  });

  it('a missing final-frame acknowledgement still rejects when browser context close also hangs', async () => {
    vi.useFakeTimers();
    const onFrame = vi.fn();
    const live = useLiveStream({ onFrame });
    await live.start();
    vi.spyOn(data.contexts[0], 'close').mockImplementation(() => new Promise(() => {}));
    const port = data.worklet.port;
    const lateFrame = port.onmessage;
    vi.spyOn(port, 'postMessage').mockImplementation(() => {});
    const failed = expect(live.stop()).rejects.toThrow('final audio frame');
    expect(data.tracks[0].stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000 + AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
    await failed;
    // A delayed acknowledgement/frame cannot revise the rejected stop or deliver new speech.
    port.dispatchEvent(new MessageEvent('message', { data: { type: 'stopped' } }));
    lateFrame({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('unmount detaches live input immediately despite a context that never closes', async () => {
    vi.useFakeTimers();
    const onFrame = vi.fn();
    const live = useLiveStream({ onFrame });
    const unmount = data.effects.at(-1)!();
    await live.start();
    vi.spyOn(data.contexts[0], 'close').mockImplementation(() => new Promise(() => {}));
    const lateFrame = data.worklet.port.onmessage;
    unmount?.();
    expect(data.tracks[0].stopped).toBe(true);
    lateFrame({ data: { type: 'frames', samples: new Float32Array(480).fill(0.2) } });
    expect(onFrame).not.toHaveBeenCalled();
    await expect(live.start()).rejects.toThrow('no longer available');
    await vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  const prepareFileBoundaries = () => {
    vi.stubGlobal('window', { AudioContext: AudioContextMock });
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        destination = {};
        createBufferSource() {
          return { connect() {}, start() {}, buffer: null };
        }
        async startRendering() {
          return { getChannelData: () => new Float32Array(48000).fill(0.2) };
        }
      },
    );
  };
  it('file decoder rejects successful completion when upload remains pending', async () => {
    prepareFileBoundaries();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 400 }));
    await expect(
      uploadAudioFile({ sessionId: 's-1', file: new File(['fixture'], 'fixture.wav') }),
    ).rejects.toBeInstanceOf(IncompleteAudioUploadError);
    expect(data.chunks.size).toBe(1);
  });
  it('failed file storage cannot be mistaken for a retryable finished upload', async () => {
    prepareFileBoundaries();
    data.failInsert = true;
    await expect(
      uploadAudioFile({ sessionId: 's-1', file: new File(['fixture'], 'fixture.wav') }),
    ).rejects.toBeInstanceOf(AudioFileStorageError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('capture persistence and stop acknowledgement', () => {
  it('keeps retry bytes on failed storage and serializes committed writes', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage full'))
      .mockResolvedValue(undefined);
    const queue = new AudioPersistenceQueue(write);
    queue.add(chunk());
    await expect(queue.flush()).rejects.toThrow('storage full');
    expect(queue.size).toBe(1);
    await queue.flush();
    expect(queue.size).toBe(0);
    expect(write.mock.calls[1][0].bytes).toEqual(chunk().bytes);
  });
  it('requires the final frame acknowledgement rather than silently discarding it', async () => {
    vi.useFakeTimers();
    const port = new EventTarget() as MessagePort;
    port.postMessage = vi.fn();
    const promise = stopWorklet({ port } as AudioWorkletNode);
    const rejection = expect(promise).rejects.toThrow('final audio frame');
    await vi.advanceTimersByTimeAsync(2100);
    await rejection;
  });
});
