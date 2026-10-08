import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMicrophoneSource,
  type SourceCheckEvent,
  type SourceCheckMode,
} from '../../app/dev/scribe-microphone/source-check';

class Track extends EventTarget {
  readyState = 'live';
  muted = false;
  enabled = true;
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}

class Context extends EventTarget {
  state: AudioContextState = 'suspended';
  sampleRate = 48_000;
  sinkId: string | { type: 'none' } = '';
  resume = vi.fn(async () => {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  });
  close = vi.fn(async () => {
    this.state = 'closed';
    this.dispatchEvent(new Event('statechange'));
  });
  createMediaStreamSource = vi.fn(() => {
    throw new Error('Context isolation must not connect the microphone to an audio graph');
  });
  audioWorklet = { addModule: vi.fn() };
}

describe('development-only microphone source isolation', () => {
  let track: Track;
  let stream: MediaStream;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let controller: AbortController;
  let events: SourceCheckEvent[];
  const start = (mode: SourceCheckMode = 'default') =>
    checkMicrophoneSource({
      mode,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });
  const contextMock = ({ silentSupported = false, ignoreSink = false } = {}) => {
    const context = new Context();
    const construct = vi.fn(function (options?: {
      sampleRate?: number;
      sinkId?: { type: 'none' };
    }) {
      context.sinkId = !ignoreSink && options?.sinkId ? options.sinkId : '';
      context.sampleRate = options?.sampleRate ?? 44_100;
      return context;
    });
    if (silentSupported) construct.prototype.setSinkId = vi.fn();
    vi.stubGlobal('AudioContext', construct);
    return { context, construct };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    track = new Track();
    stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => {
        throw new Error('Source-only check must not create an audio graph');
      }),
    );
    controller = new AbortController();
    events = [];
  });
  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('holds a basic track briefly without reading samples or starting an audio graph', async () => {
    const result = start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(events.map((event) => event.phase)).toEqual(['requesting', 'live', 'complete']);
    expect(events.at(-1)).toMatchObject({ state: 'live', muted: false, enabled: true });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(AudioContext).not.toHaveBeenCalled();
  });
  it('reports a real ended event before cleanup stops the track', async () => {
    const result = start();
    await vi.advanceTimersByTimeAsync(0);
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    await result;
    expect(events.at(-1)).toMatchObject({ phase: 'ended', state: 'ended' });
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('can isolate Scribe capture preferences without an audio graph', async () => {
    const result = checkMicrophoneSource({
      signal: controller.signal,
      mode: 'scribe',
      onEvent: (event) => events.push(event),
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(events.at(-1)).toMatchObject({ mode: 'scribe', phase: 'complete' });
    expect(AudioContext).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('can hold the same selected device without exposing its identifier in results', async () => {
    const result = checkMicrophoneSource({
      signal: controller.signal,
      deviceId: 'built-in-test',
      onEvent: (event) => events.push(event),
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'built-in-test' } },
      video: false,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(events.at(-1)).toMatchObject({ input: 'selected', phase: 'complete' });
    expect(JSON.stringify(events)).not.toContain('built-in-test');
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('cancels and releases a late permission grant', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const result = start();
    controller.abort();
    await result;
    grant(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)?.phase).toBe('cancelled');
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('bounds an unanswered permission prompt and releases any later grant', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const result = start();
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(events.at(-1)?.phase).toBe('timeout');
    grant(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('stops on a hidden page without retaining the physical microphone', async () => {
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', document);
    const result = start();
    await vi.advanceTimersByTimeAsync(0);
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await result;
    expect(events.at(-1)?.phase).toBe('cancelled');
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('isolates a normal 48 kHz context without reading or routing microphone samples', async () => {
    const { context, construct } = contextMock();
    const result = checkMicrophoneSource({
      mode: 'context',
      deviceId: 'private-built-in-id',
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: { exact: 'private-built-in-id' },
      },
      video: false,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(construct).toHaveBeenCalledExactlyOnceWith({ sampleRate: 48_000 });
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(context.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(events.map((event) => event.phase)).toEqual([
      'requesting',
      'live',
      'context-starting',
      'context-created',
      'context-running',
      'complete',
    ]);
    expect(events.at(-1)).toMatchObject({
      contextState: 'running',
      state: 'live',
      contextSampleRate: 48_000,
      constructorMs: 0,
      captureElapsedMs: 3_000,
      deadlineExceeded: false,
    });
    expect(JSON.stringify(events)).not.toContain('private-built-in-id');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(track.stop.mock.invocationCallOrder[0]).toBeLessThan(
      context.close.mock.invocationCallOrder[0],
    );
  });
  it('constructs a confirmed silent sink without switching to the normal output', async () => {
    const { context, construct } = contextMock({ silentSupported: true });
    const result = start('silent-context');
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(construct).toHaveBeenCalledExactlyOnceWith({
      sampleRate: 48_000,
      sinkId: { type: 'none' },
    });
    expect(construct.prototype.setSinkId).not.toHaveBeenCalled();
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(context.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      mode: 'silent-context',
      phase: 'complete',
      contextState: 'running',
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('reports unsupported silent output without opening the microphone or falling back', async () => {
    const { construct } = contextMock();
    await start('silent-context');
    expect(events.map((event) => event.phase)).toEqual(['unsupported']);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });
  it('refuses a silently ignored constructor sink option and releases the capture', async () => {
    const { context, construct } = contextMock({ silentSupported: true, ignoreSink: true });
    await start('silent-context');
    expect(events.at(-1)?.phase).toBe('unsupported');
    expect(construct).toHaveBeenCalledOnce();
    expect(context.resume).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('bounds a hung context resume to eight seconds after the microphone opens', async () => {
    const { context } = contextMock();
    context.resume.mockImplementation(() => new Promise(() => {}));
    const result = start('context');
    await vi.advanceTimersByTimeAsync(7_999);
    expect(track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(events.at(-1)).toMatchObject({
      phase: 'timeout',
      elapsedMs: 8_000,
      contextState: 'suspended',
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('includes delayed context setup and the running observation in one capture deadline', async () => {
    const { context } = contextMock();
    let resume!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const result = start('context');
    await vi.advanceTimersByTimeAsync(6_000);
    context.state = 'running';
    resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({ phase: 'context-running', elapsedMs: 6_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
    expect(events.at(-1)).toMatchObject({ phase: 'timeout', elapsedMs: 8_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events.filter((event) => event.phase === 'complete')).toHaveLength(0);
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('ignores a late resume after cancellation and does not retain the context', async () => {
    const { context } = contextMock();
    let resume!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const result = start('context');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    const finishedEvents = [...events];
    resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(finishedEvents);
    expect(events.at(-1)?.phase).toBe('cancelled');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('releases physical tracks first even when context cleanup hangs', async () => {
    const { context } = contextMock();
    context.close.mockImplementation(() => new Promise(() => {}));
    let finished = false;
    const result = start('context').then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(finished).toBe(true);
  });
  it('releases late grants without constructing a context after cancellation', async () => {
    const { construct } = contextMock();
    let grant!: (media: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const result = start('context');
    controller.abort();
    await result;
    grant(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(construct).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('releases a context created during synchronous cancellation', async () => {
    const { context, construct } = contextMock();
    construct.mockImplementation(() => {
      controller.abort();
      return context;
    });
    await start('context');
    expect(events.at(-1)?.phase).toBe('cancelled');
    expect(context.resume).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('cleans up context state and track listeners after a track ends', async () => {
    const { context } = contextMock();
    const result = start('context');
    await vi.advanceTimersByTimeAsync(0);
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    await result;
    const finishedEvents = [...events];
    track.dispatchEvent(new Event('mute'));
    context.dispatchEvent(new Event('statechange'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(finishedEvents);
    expect(events.at(-1)?.phase).toBe('ended');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('stops if the running context becomes unavailable during observation', async () => {
    const { context } = contextMock();
    const result = start('context');
    await vi.advanceTimersByTimeAsync(1_000);
    context.state = 'suspended';
    context.dispatchEvent(new Event('statechange'));
    await result;
    expect(events.at(-1)).toMatchObject({ phase: 'unavailable', contextState: 'suspended' });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('compares the native context rate without changing selected Scribe input preferences', async () => {
    const { context, construct } = contextMock();
    const result = checkMicrophoneSource({
      mode: 'native-context',
      deviceId: 'private-selected-device',
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(construct).toHaveBeenCalledExactlyOnceWith();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 48_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: { exact: 'private-selected-device' },
      },
      video: false,
    });
    expect(events.find((event) => event.phase === 'context-created')).toMatchObject({
      contextSampleRate: 44_100,
      constructorMs: 0,
    });
    expect(events.at(-1)).toMatchObject({ mode: 'native-context', phase: 'complete' });
    expect(JSON.stringify(events)).not.toContain('private-selected-device');
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(context.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('classifies an overdue synchronous constructor immediately after it returns', async () => {
    const { context, construct } = contextMock();
    construct.mockImplementation(() => {
      // Move elapsed time without servicing timer callbacks: a blocked native call.
      vi.setSystemTime(Date.now() + 10_154);
      context.state = 'running';
      return context;
    });
    await start('context');
    expect(events.find((event) => event.phase === 'context-created')).toMatchObject({
      constructorMs: 10_154,
      captureElapsedMs: 10_154,
      deadlineExceeded: true,
      contextState: 'running',
      contextSampleRate: 48_000,
    });
    expect(events.at(-1)?.phase).toBe('timeout');
    expect(
      events.some((event) => event.phase === 'context-running' || event.phase === 'complete'),
    ).toBe(false);
    expect(context.resume).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it.each<SourceCheckMode>(['default', 'scribe', 'context', 'silent-context', 'native-context'])(
    'does not pass %s when a completion callback beats an overdue deadline callback',
    async (mode) => {
      contextMock({ silentSupported: true });
      const result = start(mode);
      await vi.advanceTimersByTimeAsync(0);
      vi.setSystemTime(Date.now() + 9_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await result;
      expect(events.at(-1)).toMatchObject({ phase: 'timeout', deadlineExceeded: true });
      expect(events.some((event) => event.phase === 'complete')).toBe(false);
      expect(track.stop).toHaveBeenCalledOnce();
    },
  );
  it('rejects a late resume before a delayed capture-deadline timer can run', async () => {
    const { context } = contextMock();
    let resume!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const result = start('context');
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 9_000);
    context.state = 'running';
    resume();
    await result;
    expect(events.at(-1)).toMatchObject({ phase: 'timeout', deadlineExceeded: true });
    expect(events.some((event) => event.phase === 'context-running')).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it.each(['ended', 'cancelled'] as const)(
    'preserves the real %s event alongside the overdue flag',
    async (reason) => {
      contextMock();
      const result = start('context');
      await vi.advanceTimersByTimeAsync(0);
      vi.setSystemTime(Date.now() + 9_000);
      if (reason === 'ended') {
        track.readyState = 'ended';
        track.dispatchEvent(new Event('ended'));
      } else controller.abort();
      await result;
      expect(events.at(-1)).toMatchObject({ phase: reason, deadlineExceeded: true });
      expect(track.stop).toHaveBeenCalledOnce();
    },
  );
  it('preserves an ended track observed when a stalled constructor returns', async () => {
    const { context, construct } = contextMock();
    construct.mockImplementation(() => {
      vi.setSystemTime(Date.now() + 10_000);
      track.readyState = 'ended';
      return context;
    });
    await start('context');
    expect(events.at(-1)).toMatchObject({ phase: 'ended', state: 'ended', deadlineExceeded: true });
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it('does not accept a late grant that beats a delayed permission-timeout callback', async () => {
    let grant!: (media: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const { construct } = contextMock();
    const result = start('context');
    vi.setSystemTime(Date.now() + 31_000);
    grant(stream);
    await result;
    expect(events.at(-1)?.phase).toBe('timeout');
    expect(construct).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('does not mistake a queued ended event for a completed source observation', async () => {
    const result = start();
    await vi.advanceTimersByTimeAsync(0);
    track.readyState = 'ended';
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(events.at(-1)?.phase).toBe('ended');
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
