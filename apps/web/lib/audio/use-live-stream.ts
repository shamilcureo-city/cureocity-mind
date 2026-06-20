'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PolyphaseDecimator, float32ToInt16Le } from '@cureocity/audio';

export type LiveStreamState = 'idle' | 'preparing' | 'streaming' | 'error';

export interface LiveStreamOptions {
  /** Called with each decimated 16 kHz s16le PCM frame as it's captured. */
  onFrame: (pcm: Uint8Array) => void;
}

export interface LiveStreamHandle {
  state: LiveStreamState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Sprint DV4 (full) — the browser side of the live copilot.
 *
 * Captures the mic (48 kHz mono), decimates to 16 kHz (the same
 * PolyphaseDecimator the batch recorder uses), quantises to signed
 * 16-bit LE PCM, and hands each frame to `onFrame` — which the live
 * page streams straight to the WebSocket gateway as a binary message.
 *
 * Unlike useSessionRecorder this does NOT chunk to IndexedDB or upload;
 * the gateway transcribes the rolling buffer live. Same worklet
 * (/recorder-worklet.js, cureocity-recorder) and resampler, so the audio
 * is bit-for-bit what the proven Pass-1 path expects.
 */
export function useLiveStream(opts: LiveStreamOptions): LiveStreamHandle {
  const [state, setState] = useState<LiveStreamState>('idle');
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const decimatorRef = useRef<PolyphaseDecimator | null>(null);
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;

  const teardown = useCallback(async (): Promise<void> => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    decimatorRef.current?.reset();
    decimatorRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    setState('preparing');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48_000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 48_000 });
      await ctx.audioWorklet.addModule('/recorder-worklet.js');
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'cureocity-recorder');
      workletRef.current = worklet;

      const decimator = new PolyphaseDecimator(3);
      decimatorRef.current = decimator;

      worklet.port.onmessage = (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (e.data.type !== 'frames' || !decimatorRef.current) return;
        const decimated = decimatorRef.current.process(e.data.samples);
        if (decimated.length === 0) return;
        onFrameRef.current(float32ToInt16Le(decimated));
      };

      source.connect(worklet);
      // Output is unused, but the node must reach the destination for the
      // audio thread to schedule it.
      worklet.connect(ctx.destination);

      setState('streaming');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
      await teardown();
    }
  }, [teardown]);

  const stop = useCallback(async (): Promise<void> => {
    workletRef.current?.port.postMessage({ type: 'stop' });
    await teardown();
    setState('idle');
  }, [teardown]);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  return { state, error, start, stop };
}
