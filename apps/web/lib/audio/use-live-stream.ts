'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PolyphaseDecimator, float32ToInt16Le } from '@cureocity/audio';
import { stopWorklet } from './stop-worklet';
import { closeDetachedAudioContext } from './live-stream-cleanup';

export type LiveStreamState = 'idle' | 'preparing' | 'streaming' | 'error';

export interface LiveStreamOptions {
  /** Called with each decimated 16 kHz s16le PCM frame as it's captured. */
  onFrame: (pcm: Uint8Array) => void;
  /** Exact microphone selected and proven by Mind preflight. */
  selectedDeviceId?: string;
  onInterrupted?: (message: string) => void;
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

  type Capture = {
    stream?: MediaStream;
    ctx?: AudioContext;
    source?: MediaStreamAudioSourceNode;
    worklet?: AudioWorkletNode;
    decimator?: PolyphaseDecimator;
    closing?: Promise<void>;
    stopping: boolean;
  };
  const captureRef = useRef<Capture | null>(null);
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;
  const interruptedRef = useRef(opts.onInterrupted);
  interruptedRef.current = opts.onInterrupted;
  const generationRef = useRef(0);
  const disposedRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const teardown = useCallback(async (capture: Capture | null): Promise<void> => {
    if (!capture) return;
    capture.stopping = true;
    if (captureRef.current === capture) captureRef.current = null;
    capture.stream?.getTracks().forEach((t) => t.stop());
    // Detach only this capture. Late port/context events cannot reach a replacement.
    if (capture.worklet) capture.worklet.port.onmessage = null;
    capture.source?.disconnect();
    capture.worklet?.disconnect();
    capture.decimator?.reset();
    if (capture.ctx) {
      capture.closing ??= closeDetachedAudioContext(capture.ctx);
      await capture.closing;
    }
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (disposedRef.current) throw new Error('Capture is no longer available on this page.');
    const generation = ++generationRef.current;
    await stopInFlightRef.current;
    await teardown(captureRef.current);
    if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
    const capture: Capture = { stopping: false };
    captureRef.current = capture;
    setState('preparing');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48_000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          ...(opts.selectedDeviceId ? { deviceId: { exact: opts.selectedDeviceId } } : {}),
        },
      });
      capture.stream = stream;
      if (generation !== generationRef.current) {
        throw new Error('Capture start was cancelled.');
      }
      const interrupted = (message: string) => {
        if (capture.stopping || generation !== generationRef.current) return;
        ++generationRef.current;
        setError(message);
        setState('error');
        void teardown(capture);
        interruptedRef.current?.(message);
      };
      stream.getAudioTracks().forEach((track) => {
        const unavailable = () =>
          interrupted(
            'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
          );
        track.addEventListener('ended', unavailable);
        track.addEventListener('mute', unavailable);
      });

      const ctx = new AudioContext({ sampleRate: 48_000 });
      capture.ctx = ctx;
      await ctx.audioWorklet.addModule('/recorder-worklet.js');
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running') await ctx.resume();
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running')
        throw new Error('Audio capture is suspended. Resume capture when this tab is active.');
      ctx.addEventListener('statechange', () => {
        if (ctx.state !== 'running')
          interrupted(
            'Audio capture was interrupted by the browser or device. Keep this tab active and resume capture.',
          );
      });

      const source = ctx.createMediaStreamSource(stream);
      capture.source = source;
      const worklet = new AudioWorkletNode(ctx, 'cureocity-recorder');
      capture.worklet = worklet;

      const decimator = new PolyphaseDecimator(3);
      capture.decimator = decimator;

      worklet.port.onmessage = (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (e.data.type !== 'frames' || captureRef.current !== capture) return;
        const decimated = decimator.process(e.data.samples);
        if (decimated.length === 0) return;
        onFrameRef.current(float32ToInt16Le(decimated));
      };

      source.connect(worklet);
      // Output is unused, but the node must reach the destination for the
      // audio thread to schedule it.
      worklet.connect(ctx.destination);

      setState('streaming');
    } catch (e) {
      if (generation === generationRef.current) {
        setError((e as Error).message);
        setState('error');
      }
      await teardown(capture);
      throw e;
    }
  }, [opts.selectedDeviceId, teardown]);

  const stop = useCallback((): Promise<void> => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const generation = ++generationRef.current;
    const capture = captureRef.current;
    if (capture) {
      capture.stopping = true;
      // Stop the physical input immediately; already-posted worklet frames
      // still drain in port order before its acknowledgement.
      capture.stream?.getTracks().forEach((track) => track.stop());
    }
    const work = (async () => {
      try {
        await stopWorklet(capture?.worklet ?? null);
      } finally {
        await teardown(capture);
        if (generation === generationRef.current) setState('idle');
      }
    })();
    stopInFlightRef.current = work.finally(() => {
      stopInFlightRef.current = null;
    });
    return stopInFlightRef.current;
  }, [teardown]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      ++generationRef.current;
      void teardown(captureRef.current);
    };
  }, [teardown]);

  return { state, error, start, stop };
}
