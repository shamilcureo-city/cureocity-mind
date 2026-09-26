'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PolyphaseDecimator, float32ToInt16Le } from '@cureocity/audio';
import { stopWorklet } from './stop-worklet';
import { closeDetachedAudioContext } from './live-stream-cleanup';
import { measureInputLevel } from './input-level';
import {
  cloneExternalAudio,
  EXTERNAL_AUDIO_INTERRUPTED_EVENT,
  usableExternalAudio,
} from './external-live-audio';

const INPUT_LEVEL_UPDATE_INTERVAL_MS = 100;

export type LiveStreamState = 'idle' | 'preparing' | 'streaming' | 'error';

export interface LiveStreamOptions {
  /** Called with each decimated 16 kHz s16le PCM frame as it's captured. */
  onFrame: (pcm: Uint8Array) => void;
  /** Exact microphone selected and proven by Mind preflight. */
  selectedDeviceId?: string;
  /** Explicit external mode never falls back to a microphone, even without a stream. */
  captureSource?: 'microphone' | 'external';
  externalStream?: MediaStream | null;
  /** External callers must verify both call participants before enabling capture. */
  externalReady?: boolean;
  externalUnavailableReason?: string | null;
  onInterrupted?: (message: string) => void;
}

export interface LiveStreamHandle {
  state: LiveStreamState;
  error: string | null;
  /** Actual capture-input RMS amplitude (0..1), updated at most ten times per second. */
  inputLevel: number;
  /** Unix milliseconds of the last observed audio frame, including silent frames. */
  lastAudioAt: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Sprint DV4 (full) — the browser side of the live copilot.
 *
 * Captures the mic by default, or recorder-owned clones of an explicitly
 * supplied call stream. Decimates to 16 kHz (the same
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
  const [input, setInput] = useState({ inputLevel: 0, lastAudioAt: null as number | null });

  type Capture = {
    stream?: MediaStream;
    ctx?: AudioContext;
    source?: MediaStreamAudioSourceNode;
    worklet?: AudioWorkletNode;
    decimator?: PolyphaseDecimator;
    closing?: Promise<void>;
    stopping: boolean;
    lastInputUpdateAt?: number;
    inputSource: 'microphone' | 'external';
    originalStream?: MediaStream;
    cleanupListeners: Array<() => void>;
    interrupt?: (message: string) => void;
  };
  const captureRef = useRef<Capture | null>(null);
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;
  const interruptedRef = useRef(opts.onInterrupted);
  interruptedRef.current = opts.onInterrupted;
  const optionsRef = useRef(opts);
  optionsRef.current = opts;
  const generationRef = useRef(0);
  const disposedRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const teardown = useCallback(async (capture: Capture | null): Promise<void> => {
    if (!capture) return;
    capture.stopping = true;
    capture.cleanupListeners.splice(0).forEach((cleanup) => cleanup());
    if (captureRef.current === capture) {
      captureRef.current = null;
      if (!disposedRef.current) setInput({ inputLevel: 0, lastAudioAt: null });
    }
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
    const input = optionsRef.current;
    const capture: Capture = {
      stopping: false,
      inputSource: input.captureSource ?? 'microphone',
      cleanupListeners: [],
    };
    captureRef.current = capture;
    setState('preparing');
    setError(null);
    setInput({ inputLevel: 0, lastAudioAt: null });
    try {
      if (
        capture.inputSource === 'external' &&
        (!input.externalReady || !usableExternalAudio(input.externalStream))
      ) {
        throw new Error(
          input.externalUnavailableReason ||
            'Both sides of the call must be connected and unmuted before recording.',
        );
      }
      const stream =
        capture.inputSource === 'external'
          ? cloneExternalAudio(input.externalStream!)
          : await navigator.mediaDevices.getUserMedia({
              audio: {
                sampleRate: 48_000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                ...(input.selectedDeviceId ? { deviceId: { exact: input.selectedDeviceId } } : {}),
              },
            });
      capture.stream = stream;
      if (capture.inputSource === 'external') capture.originalStream = input.externalStream!;
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
      capture.interrupt = interrupted;
      const listen = (target: EventTarget, event: string, callback: EventListener) => {
        target.addEventListener(event, callback);
        capture.cleanupListeners.push(() => target.removeEventListener(event, callback));
      };
      const monitoredTracks = new Set([
        ...stream.getAudioTracks(),
        ...(capture.originalStream?.getAudioTracks() ?? []),
      ]);
      monitoredTracks.forEach((track) => {
        const unavailable = () =>
          interrupted(
            capture.inputSource === 'external'
              ? 'Call audio stopped or became unavailable. Reconnect both sides before resuming capture.'
              : 'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
          );
        listen(track, 'ended', unavailable);
        listen(track, 'mute', unavailable);
      });
      if (capture.originalStream) {
        const lostSource = () =>
          interrupted(
            'Call audio changed or was interrupted. Check both sides and resume capture explicitly.',
          );
        listen(capture.originalStream, EXTERNAL_AUDIO_INTERRUPTED_EVENT, lostSource);
        listen(capture.originalStream, 'removetrack', lostSource);
        listen(capture.originalStream, 'addtrack', lostSource);
      }

      const ctx = new AudioContext({ sampleRate: 48_000 });
      capture.ctx = ctx;
      await ctx.audioWorklet.addModule('/recorder-worklet.js');
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running') await ctx.resume();
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running')
        throw new Error('Audio capture is suspended. Resume capture when this tab is active.');
      listen(ctx, 'statechange', () => {
        if (ctx.state !== 'running')
          interrupted(
            'Audio capture was interrupted by the browser or device. Keep this tab active and resume capture.',
          );
      });

      const currentInput = optionsRef.current;
      if (
        (currentInput.captureSource ?? 'microphone') !== capture.inputSource ||
        (capture.inputSource === 'external' &&
          (!currentInput.externalReady ||
            currentInput.externalStream !== capture.originalStream ||
            !usableExternalAudio(capture.originalStream)))
      )
        throw new Error(
          'Call audio changed while recording was preparing. Check both sides and try again.',
        );

      const source = ctx.createMediaStreamSource(stream);
      capture.source = source;
      const worklet = new AudioWorkletNode(ctx, 'cureocity-recorder');
      capture.worklet = worklet;

      const decimator = new PolyphaseDecimator(3);
      capture.decimator = decimator;

      worklet.port.onmessage = (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (e.data.type !== 'frames' || captureRef.current !== capture) return;
        // Track.stop() need not emit ended. Do not accept another frame from a
        // destination whose source has already ended or lost two-sided readiness.
        if (!capture.stopping && capture.inputSource === 'external') {
          const current = optionsRef.current;
          if (
            !current.externalReady ||
            current.externalStream !== capture.originalStream ||
            !usableExternalAudio(capture.originalStream)
          ) {
            interrupted(
              current.externalUnavailableReason ||
                'Call audio is unavailable. Check both sides before resuming capture.',
            );
            return;
          }
        }
        const now = performance.now();
        if (
          !capture.stopping &&
          e.data.samples.length > 0 &&
          (capture.lastInputUpdateAt === undefined ||
            now - capture.lastInputUpdateAt >= INPUT_LEVEL_UPDATE_INTERVAL_MS)
        ) {
          capture.lastInputUpdateAt = now;
          setInput({ inputLevel: measureInputLevel(e.data.samples), lastAudioAt: Date.now() });
        }
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
  }, [teardown]);

  const stop = useCallback((): Promise<void> => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const generation = ++generationRef.current;
    const capture = captureRef.current;
    if (!disposedRef.current) setInput({ inputLevel: 0, lastAudioAt: null });
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
    const capture = captureRef.current;
    if (!capture || capture.stopping) return;
    if (
      (opts.captureSource ?? 'microphone') !== capture.inputSource ||
      (capture.inputSource === 'external' &&
        (!opts.externalReady ||
          opts.externalStream !== capture.originalStream ||
          !usableExternalAudio(opts.externalStream)))
    ) {
      capture.interrupt?.(
        opts.externalUnavailableReason ||
          'Call audio is no longer ready. Check both sides and resume capture explicitly.',
      );
    }
  }, [opts.captureSource, opts.externalStream, opts.externalReady, opts.externalUnavailableReason]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      ++generationRef.current;
      void teardown(captureRef.current);
    };
  }, [teardown]);

  return { state, error, ...input, start, stop };
}
