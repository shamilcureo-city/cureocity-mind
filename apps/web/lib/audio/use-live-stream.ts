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
const MICROPHONE_STARTUP_TIMEOUT_MS = 8_000;

export type LiveStreamState = 'idle' | 'preparing' | 'streaming' | 'error';

export interface LiveStreamOptions {
  /** Called with each decimated 16 kHz s16le PCM frame as it's captured. */
  onFrame: (pcm: Uint8Array) => void;
  /** Exact microphone selected and proven by Mind preflight. */
  selectedDeviceId?: string;
  /** Scribe opt-in: wait for valid local PCM and tolerate bounded startup mute. */
  waitForMicrophoneFrames?: boolean;
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
    ready: boolean;
    waitForFrames: boolean;
    acquiredAt?: number;
    startupTimer?: ReturnType<typeof setTimeout>;
    startupDeadlineAt?: number;
    startupWasUnavailable?: boolean;
    discardFramesThrough?: number;
    cancelStart?: (reason: Error) => void;
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
    clearTimeout(capture.startupTimer);
    capture.cancelStart?.(new Error('Capture start was cancelled.'));
    capture.cancelStart = undefined;
    capture.cleanupListeners.splice(0).forEach((cleanup) => cleanup());
    if (captureRef.current === capture) {
      captureRef.current = null;
      if (!disposedRef.current) setInput({ inputLevel: 0, lastAudioAt: null });
    }
    capture.stream?.getTracks().forEach((t) => t.stop());
    // Detach only this capture. Late port/context events cannot reach a replacement.
    if (capture.worklet) {
      capture.worklet.port.onmessage = null;
      capture.worklet.onprocessorerror = null;
    }
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
      ready: false,
      inputSource: input.captureSource ?? 'microphone',
      waitForFrames:
        (input.captureSource ?? 'microphone') === 'microphone' &&
        input.waitForMicrophoneFrames === true,
      cleanupListeners: [],
    };
    // Race every browser wait with cancellation. A pending permission prompt or
    // worklet module must not keep an abandoned start alive indefinitely.
    let startError: Error | undefined;
    const startFailure = new Promise<never>((_resolve, reject) => {
      capture.cancelStart = (reason) => {
        startError ??= reason;
        reject(startError);
      };
    });
    // Interruption can happen between browser awaits; keep rejection handled
    // until the next race observes its original, actionable error.
    void startFailure.catch(() => {});
    const isCurrent = () =>
      !capture.stopping && !disposedRef.current && generation === generationRef.current;
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
      const request =
        capture.inputSource === 'external'
          ? Promise.resolve(cloneExternalAudio(input.externalStream!))
          : navigator.mediaDevices.getUserMedia({
              audio: {
                sampleRate: 48_000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                ...(input.selectedDeviceId ? { deviceId: { exact: input.selectedDeviceId } } : {}),
              },
            });
      const stream = await Promise.race([
        request.then((acquired) => {
          // getUserMedia itself cannot be cancelled. Release a late grant even
          // after the cancelled start has already settled and left this scope.
          if (!isCurrent()) acquired.getTracks().forEach((track) => track.stop());
          else {
            // Claim ownership here, before Promise.race schedules its awaiting
            // continuation: stop may win that next microtask turn.
            capture.stream = acquired;
            capture.acquiredAt = Date.now();
          }
          return acquired;
        }),
        startFailure,
      ]);
      capture.stream = stream;
      capture.acquiredAt ??= Date.now();
      if (capture.inputSource === 'external') capture.originalStream = input.externalStream!;
      if (generation !== generationRef.current) {
        throw new Error('Capture start was cancelled.');
      }
      const interrupted = (message: string, reason = 'source-unavailable') => {
        if (capture.stopping || generation !== generationRef.current) return;
        // Fixed diagnostic fields only: never log speech, device identifiers,
        // patient/session details, tokens or browser exception payloads.
        console.warn('[live-capture] interrupted', {
          reason,
          stage: capture.ready ? 'streaming' : 'preparing',
          source: capture.inputSource,
          elapsedMs: Date.now() - capture.acquiredAt!,
          tracks: stream.getAudioTracks().map((track) => ({
            readyState: track.readyState,
            muted: track.muted,
            enabled: track.enabled,
          })),
          contextState: capture.ctx?.state ?? 'not-created',
        });
        capture.cancelStart?.(new Error(message));
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
      if (capture.inputSource === 'microphone' && monitoredTracks.size === 0)
        throw new Error('No microphone audio track was supplied. Choose a microphone and retry.');
      capture.startupWasUnavailable = [...monitoredTracks].some(
        (track) => track.muted || !track.enabled,
      );
      monitoredTracks.forEach((track) => {
        const unavailable = (reason: 'track-ended' | 'track-muted') =>
          interrupted(
            capture.inputSource === 'external'
              ? 'Call audio stopped or became unavailable. Reconnect both sides before resuming capture.'
              : 'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
            reason,
          );
        listen(track, 'ended', () => unavailable('track-ended'));
        listen(track, 'mute', () => {
          // Local devices may briefly report mute while their source warms up.
          // No PCM is accepted until unmuted; a bounded deadline below still
          // fails closed. Once streaming, every interruption remains fatal.
          if (!capture.waitForFrames || capture.ready) unavailable('track-muted');
          else {
            capture.startupWasUnavailable = true;
            capture.discardFramesThrough = Date.now();
            capture.decimator?.reset();
          }
        });
        listen(track, 'unmute', () => {
          if (!capture.waitForFrames || capture.ready || !isCurrent()) return;
          capture.startupWasUnavailable = false;
          capture.discardFramesThrough = Date.now();
          capture.decimator?.reset();
        });
      });
      if ([...monitoredTracks].some((track) => track.readyState === 'ended')) {
        interrupted(
          'The audio source ended before capture could start. Reconnect it and retry.',
          'track-ended',
        );
        await startFailure;
      }
      let resolveFirstFrame: (() => void) | undefined;
      const firstFrame = new Promise<void>((resolve) => {
        resolveFirstFrame = resolve;
      });
      const startupTimedOut = () => {
        const tracks = stream.getAudioTracks();
        if (tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) {
          interrupted(
            'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
            'track-ended',
          );
        } else if (tracks.some((track) => track.muted || !track.enabled)) {
          interrupted(
            'The microphone stayed muted during startup. Check your system input device and retry.',
            'startup-muted',
          );
        } else if (!capture.worklet || capture.ctx?.state !== 'running') {
          interrupted(
            'Microphone audio could not become ready in time. Reload this page and retry.',
            'startup-setup-timeout',
          );
        } else {
          interrupted(
            'The microphone opened but supplied no audio frames. Check your system input device and retry.',
            'startup-no-frames',
          );
        }
      };
      if (capture.waitForFrames) {
        capture.startupDeadlineAt = capture.acquiredAt + MICROPHONE_STARTUP_TIMEOUT_MS;
        capture.startupTimer = setTimeout(startupTimedOut, MICROPHONE_STARTUP_TIMEOUT_MS);
      }
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
      await Promise.race([ctx.audioWorklet.addModule('/recorder-worklet.js'), startFailure]);
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), startFailure]);
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
      if (ctx.state !== 'running')
        throw new Error('Audio capture is suspended. Resume capture when this tab is active.');
      listen(ctx, 'statechange', () => {
        if (ctx.state !== 'running')
          interrupted(
            'Audio capture was interrupted by the browser or device. Keep this tab active and resume capture.',
            'context-not-running',
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
      worklet.onprocessorerror = () =>
        interrupted(
          'The browser audio processor failed. Reload this page and retry microphone capture.',
          'worklet-error',
        );

      const decimator = new PolyphaseDecimator(3);
      capture.decimator = decimator;

      worklet.port.onmessage = (
        e: MessageEvent<{ type: string; samples: Float32Array; capturedAt?: number }>,
      ) => {
        if (e.data.type !== 'frames' || captureRef.current !== capture) return;
        if (capture.inputSource === 'microphone') {
          // Intentional stop may drain PCM already posted before track.stop().
          // Before readiness there is no accepted tail to drain at all.
          if (capture.stopping && !capture.ready) return;
          if (!capture.stopping) {
            if (
              capture.waitForFrames &&
              !capture.ready &&
              Date.now() >= capture.startupDeadlineAt!
            ) {
              startupTimedOut();
              return;
            }
            const tracks = stream.getAudioTracks();
            if (tracks.length === 0 || tracks.some((track) => track.readyState !== 'live')) {
              interrupted(
                'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
                'track-ended',
              );
              return;
            }
            if (tracks.some((track) => track.muted || !track.enabled)) {
              capture.startupWasUnavailable = true;
              capture.discardFramesThrough = Date.now();
              decimator.reset();
              if (capture.ready)
                interrupted(
                  'The microphone stopped or became unavailable. Reconnect it before resuming capture.',
                  'track-muted',
                );
              return;
            }
            if (ctx.state !== 'running') {
              interrupted(
                'Audio capture was interrupted by the browser or device. Keep this tab active and resume capture.',
                'context-not-running',
              );
              return;
            }
            if (capture.waitForFrames && !capture.ready && capture.startupWasUnavailable) {
              // enabled has no unmute event. Require a frame captured after we
              // observed recovery, rather than accepting queued disabled audio.
              capture.startupWasUnavailable = false;
              capture.discardFramesThrough = Date.now();
              decimator.reset();
            }
            if (
              capture.waitForFrames &&
              !capture.ready &&
              capture.discardFramesThrough !== undefined &&
              (!Number.isFinite(e.data.capturedAt) ||
                e.data.capturedAt! <= capture.discardFramesThrough)
            )
              return;
          }
        }
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
        if (capture.waitForFrames && !capture.ready) {
          capture.ready = true;
          clearTimeout(capture.startupTimer);
          setState('streaming');
          resolveFirstFrame?.();
        }
        onFrameRef.current(float32ToInt16Le(decimated));
      };

      source.connect(worklet);
      // Output is unused, but the node must reach the destination for the
      // audio thread to schedule it.
      worklet.connect(ctx.destination);
      if (!isCurrent()) throw startError ?? new Error('Capture start was cancelled.');

      if (capture.waitForFrames) await Promise.race([firstFrame, startFailure]);
      else {
        capture.ready = true;
        setState('streaming');
      }
      // The first-frame consumer may synchronously stop/unmount/interrupt the
      // capture. Readiness must never turn that cancelled start into success.
      if (!isCurrent()) throw startError ?? new Error('Capture start was cancelled.');
      capture.cancelStart = undefined;
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
      clearTimeout(capture.startupTimer);
      capture.cancelStart?.(new Error('Capture start was cancelled.'));
      // Stop the physical input immediately; already-posted worklet frames
      // still drain in port order before its acknowledgement.
      capture.stream?.getTracks().forEach((track) => track.stop());
    }
    const work = (async () => {
      try {
        if (capture?.ready) await stopWorklet(capture.worklet ?? null);
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
