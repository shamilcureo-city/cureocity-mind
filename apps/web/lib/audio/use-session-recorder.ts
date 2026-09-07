'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PcmChunker,
  PolyphaseDecimator,
  TARGET_MIME_TYPE,
  TARGET_SAMPLE_RATE_HZ,
  type PcmChunk,
} from '@cureocity/audio';
import { ChunkStore, SessionStore } from './idb-chunk-store';
import { ChunkUploader } from './chunk-uploader';
import { requestPersistentStorage } from './storage-buckets';
import { AudioPersistenceQueue } from './persistence-queue';
import { stopWorklet } from './stop-worklet';

export type RecorderState =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'pausing'
  | 'paused'
  | 'finishing'
  | 'error';

export type CaptureSource = 'mic' | 'display' | 'dictation' | 'external';

export interface RecorderOptions {
  sessionId: string;
  /** Endpoint base, defaults to '/api/v1' (same-origin). */
  scribeBase?: string;
  /** Live-stream source. 'mic' / 'dictation' use getUserMedia (mic); 'display'
   *  uses getDisplayMedia (tab audio); 'external' records an injected stream —
   *  VS1's virtual room passes a WebAudio mix of the therapist's mic and the
   *  client's incoming call audio, so BOTH voices reach the note cleanly. */
  source: CaptureSource;
  /** Exact microphone selected and proven by Mind preflight. */
  selectedDeviceId?: string;
  /** Required when source is 'external'; ignored otherwise. */
  externalStream?: MediaStream;
  /** Returns a Firebase ID token, or null to use the dev-bypass header. */
  getAuthToken?: () => Promise<string | null>;
}

export interface RecorderHandle {
  state: RecorderState;
  error: string | null;
  /** Most recently completed chunk index, for UI progress. */
  lastChunkIndex: number;
  /** Number of chunks pending upload in IndexedDB. */
  pendingCount: number;
  /** True if the chunk uploader is currently draining the queue. */
  draining: boolean;
  /** Wall-clock ms when capture started (resume-aware). */
  startedAt: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Release input and preserve the flushed tail without completing the session. */
  pause: () => Promise<void>;
  /** FLOW-2 — drain the IDB queue once more; resolves to the count still
   *  pending (0 = safe to generate the note). */
  drainPending: (retryExhausted?: boolean) => Promise<number>;
}

const SUPPORTS_DISPLAY_MEDIA =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof (navigator.mediaDevices as MediaDevices).getDisplayMedia === 'function';

/**
 * Drives the session-capture pipeline end-to-end:
 *
 *   1. requestPersistentStorage() — best-effort
 *   2. acquireStream(source) — getUserMedia (mic) or getDisplayMedia (tab audio)
 *   3. AudioContext + AudioWorklet (cureocity-recorder, /recorder-worklet.js)
 *   4. Worklet posts Float32 frames at 48 kHz
 *   5. Main thread: PolyphaseDecimator (48->16 kHz) -> PcmChunker
 *   6. ChunkUploader.drainSession() PUTs each completed chunk to /audio
 *   7. SessionStore.saveCursor() after each chunk so a refresh resumes cleanly
 *
 * Resumption: if a saved cursor exists for sessionId, the chunker resumes
 * at that index and any IDB-queued chunks are re-drained on mount.
 */
export function useSessionRecorder(opts: RecorderOptions): RecorderHandle {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastChunkIndex, setLastChunkIndex] = useState(-1);
  const [pendingCount, setPendingCount] = useState(0);
  const [draining, setDraining] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Live mirror for long-lived listeners (the track-'ended' handler below is
  // registered once at start; reading `state` there captured 'preparing'
  // forever, so a dying mic never stopped the recorder).
  const stateRef = useRef<RecorderState>('idle');
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const decimatorRef = useRef<PolyphaseDecimator | null>(null);
  const chunkerRef = useRef<PcmChunker | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  const disposedRef = useRef(false);
  const integrityErrorRef = useRef<string | null>(null);
  const pendingCountRef = useRef(0);
  pendingCountRef.current = pendingCount;
  const persistenceRef = useRef<AudioPersistenceQueue | null>(null);
  if (!persistenceRef.current)
    persistenceRef.current = new AudioPersistenceQueue(async (chunk) => {
      await ChunkStore.insert(chunk);
      const cursor = await SessionStore.getCursor(chunk.sessionId);
      await SessionStore.saveCursor({
        sessionId: chunk.sessionId,
        nextChunkIndex: Math.max(cursor?.nextChunkIndex ?? 0, chunk.chunkIndex + 1),
        startedAt: cursor?.startedAt ?? chunk.enqueuedAt,
        ...(cursor?.captureIntegrityError
          ? { captureIntegrityError: cursor.captureIntegrityError }
          : {}),
      });
    });

  const base = opts.scribeBase ?? '/api/v1';

  // Drain queued chunks on mount + on `online` event (recover from offline).
  useEffect(() => {
    const drain = async (): Promise<void> => {
      // Lazy create an uploader if one isn't already attached.
      if (!uploaderRef.current) {
        uploaderRef.current = new ChunkUploader({
          scribeBase: base,
          ...(opts.getAuthToken && { getAuthToken: opts.getAuthToken }),
        });
      }
      const pending = await ChunkStore.listForSession(opts.sessionId);
      setPendingCount(pending.length);
      if (pending.length === 0) return;
      setDraining(true);
      try {
        await uploaderRef.current.drainSession(opts.sessionId);
        const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
        setPendingCount(remaining);
      } finally {
        setDraining(false);
      }
    };
    const onOnline = (): void => {
      void drain().catch(() =>
        setError('Recording upload could not resume. Keep this tab open and retry.'),
      );
    };
    window.addEventListener('online', onOnline);
    void drain().catch(() =>
      setError('Local recording storage is unavailable. Do not start until it is restored.'),
    );
    return () => window.removeEventListener('online', onOnline);
  }, [opts.sessionId, base, opts.getAuthToken]);

  const start = useCallback(async (): Promise<void> => {
    if (disposedRef.current) throw new Error('Capture is no longer available on this page.');
    if (stateRef.current === 'recording' || stateRef.current === 'preparing')
      throw new Error('Capture is already starting or active.');
    const generation = ++generationRef.current;
    const assertCurrent = () => {
      if (generation !== generationRef.current) throw new Error('Capture start was cancelled.');
    };
    let ownedStream: MediaStream | null = null;
    let ownedContext: AudioContext | null = null;
    let ownedWorklet: AudioWorkletNode | null = null;
    setState('preparing');
    stateRef.current = 'preparing';
    setError(null);
    try {
      await stopInFlightRef.current;
      assertCurrent();
      await persistenceRef.current!.flush();
      await requestPersistentStorage();
      assertCurrent();
      const resume = await SessionStore.getCursor(opts.sessionId);
      assertCurrent();
      if (integrityErrorRef.current || resume?.captureIntegrityError) {
        integrityErrorRef.current = integrityErrorRef.current ?? resume!.captureIntegrityError!;
        throw new Error(integrityErrorRef.current);
      }

      const stream = await acquireStream(opts.source, opts.externalStream, opts.selectedDeviceId);
      ownedStream = stream;
      assertCurrent();
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 48_000 });
      ownedContext = ctx;
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule('/recorder-worklet.js');
      assertCurrent();
      if (ctx.state !== 'running') await ctx.resume();
      assertCurrent();
      if (ctx.state !== 'running')
        throw new Error('Audio capture is suspended. Resume capture when this tab is active.');

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'cureocity-recorder');
      ownedWorklet = worklet;
      workletRef.current = worklet;

      const decimator = new PolyphaseDecimator(3);
      decimatorRef.current = decimator;

      const sessionStartedAt = resume?.startedAt ?? Date.now();
      setStartedAt(sessionStartedAt);
      const chunker = new PcmChunker({
        sessionStartedAt,
        initialChunkIndex: resume?.nextChunkIndex ?? 0,
      });
      chunkerRef.current = chunker;

      const uploader = new ChunkUploader({
        scribeBase: base,
        ...(opts.getAuthToken && { getAuthToken: opts.getAuthToken }),
      });
      uploaderRef.current = uploader;

      const onCompletedChunk = (chunk: PcmChunk): void => {
        persistenceRef.current!.add({
          sessionId: opts.sessionId,
          chunkIndex: chunk.chunkIndex,
          mimeType: TARGET_MIME_TYPE,
          sampleRate: TARGET_SAMPLE_RATE_HZ,
          durationMs: chunk.durationMs,
          bytes: chunk.bytes,
          enqueuedAt: chunk.startedAt,
          attempts: 0,
        });
        setLastChunkIndex(chunk.chunkIndex);
        void persistenceRef
          .current!.flush()
          .then(() => uploader.drainSession(opts.sessionId))
          .then(async () => {
            const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
            setPendingCount(remaining);
          })
          .catch(() => {
            if (generation !== generationRef.current) return;
            setError(
              'Recording could not be saved. Capture has stopped; keep this tab open and retry saving.',
            );
            void stopInternal().catch(() => {});
          });
      };

      worklet.port.onmessage = (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (
          e.data.type !== 'frames' ||
          workletRef.current !== worklet ||
          !chunkerRef.current ||
          !decimatorRef.current
        )
          return;
        const decimated = decimatorRef.current.process(e.data.samples);
        const completed = chunkerRef.current.push(decimated);
        for (const chunk of completed) onCompletedChunk(chunk);
      };

      // If the audio source dies mid-session (mic unplugged, Bluetooth headset
      // off, screen-share revoked), stop cleanly AND say so — the worst
      // failure mode is a pulsing "Recording" badge capturing silence.
      const interrupted = (message: string) => {
        if (generation !== generationRef.current || stateRef.current !== 'recording') return;
        setError(message);
        void stopInternal().catch(() => {});
      };
      stream.getTracks().forEach((t) => {
        const unavailable = () =>
          interrupted(
            'The audio source disconnected. Capture stopped; finish saving below, or reconnect the source and resume.',
          );
        t.addEventListener('ended', unavailable);
        t.addEventListener('mute', unavailable);
      });
      ctx.addEventListener('statechange', () => {
        if (ctx.state !== 'running')
          interrupted(
            'The browser interrupted audio capture. Finish saving below, then keep this tab active and resume capture.',
          );
      });

      source.connect(worklet);
      // Worklet output is unused, but the node must be connected to the
      // destination for the audio thread to schedule it.
      worklet.connect(ctx.destination);

      setState('recording');
      stateRef.current = 'recording';
    } catch (e) {
      if (generation === generationRef.current) {
        setError((e as Error).message);
        setState('error');
        stateRef.current = 'error';
        await teardown();
      } else {
        // A cancelled permission/module request owns only its own resources.
        // Never close the stream opened by a later start.
        ownedWorklet?.disconnect();
        ownedStream?.getTracks().forEach((track) => track.stop());
        if (ownedContext && ownedContext.state !== 'closed') await ownedContext.close();
      }
      throw e;
    }
  }, [
    opts.sessionId,
    opts.source,
    opts.externalStream,
    opts.getAuthToken,
    opts.selectedDeviceId,
    base,
  ]);

  const stopInternal = useCallback(
    (pause = false): Promise<void> => {
      if (stopInFlightRef.current) return stopInFlightRef.current;
      ++generationRef.current;
      const work = (async () => {
        setState(pause ? 'pausing' : 'finishing');
        stateRef.current = pause ? 'pausing' : 'finishing';
        streamRef.current?.getTracks().forEach((track) => track.stop());
        try {
          try {
            await stopWorklet(workletRef.current);
          } catch {
            integrityErrorRef.current =
              'The final audio frame could not be confirmed. Known audio parts will be saved, but automatic finalization is blocked. Review the session and document any missing speech manually; retrying uploads cannot recover that frame.';
          }
          const finalChunks = chunkerRef.current?.flush() ?? [];
          for (const c of finalChunks) {
            persistenceRef.current!.add({
              sessionId: opts.sessionId,
              chunkIndex: c.chunkIndex,
              mimeType: TARGET_MIME_TYPE,
              sampleRate: TARGET_SAMPLE_RATE_HZ,
              durationMs: c.durationMs,
              bytes: c.bytes,
              enqueuedAt: c.startedAt,
              attempts: 0,
            });
          }
          // The tail is now owned by the retry queue. Upload backoff must not
          // leave the microphone/device open for seconds or minutes.
          await teardown();
          await persistenceRef.current!.flush();
          const cursor = await SessionStore.getCursor(opts.sessionId);
          const integrityError = integrityErrorRef.current ?? cursor?.captureIntegrityError;
          if (integrityError) {
            integrityErrorRef.current = integrityError;
            await SessionStore.saveCursor({
              sessionId: opts.sessionId,
              nextChunkIndex: cursor?.nextChunkIndex ?? 0,
              startedAt: cursor?.startedAt ?? Date.now(),
              captureIntegrityError: integrityError,
            });
          }
          if (uploaderRef.current) {
            setDraining(true);
            await uploaderRef.current.drainSession(opts.sessionId);
            setDraining(false);
          }
          const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
          setPendingCount(remaining);
          if (integrityError) throw new Error(integrityError);
          // Keep the cursor until session completion, not merely an empty queue.
          setState(pause ? 'paused' : 'idle');
          stateRef.current = pause ? 'paused' : 'idle';
        } catch (e) {
          setError((e as Error).message);
          setState('error');
          stateRef.current = 'error';
          throw e;
        } finally {
          for (const c of chunkerRef.current?.flush() ?? [])
            persistenceRef.current!.add({
              sessionId: opts.sessionId,
              chunkIndex: c.chunkIndex,
              mimeType: TARGET_MIME_TYPE,
              sampleRate: TARGET_SAMPLE_RATE_HZ,
              durationMs: c.durationMs,
              bytes: c.bytes,
              enqueuedAt: c.startedAt,
              attempts: 0,
            });
          await teardown();
          setDraining(false);
        }
      })();
      stopInFlightRef.current = work.finally(() => {
        stopInFlightRef.current = null;
      });
      return stopInFlightRef.current;
    },
    [opts.sessionId],
  );

  // Stable wrapper for the consumer.
  const stop = useCallback(() => stopInternal(), [stopInternal]);
  const pause = useCallback(() => stopInternal(true), [stopInternal]);

  // FLOW-2 — drain the IndexedDB queue once more and report how many chunks
  // still failed to upload. The End flow calls this in a retry loop so it can
  // hold ("Uploading the last part… n left") until the tail is safely on the
  // server, instead of generating a note from partial audio.
  const drainPending = useCallback(
    async (retryExhausted = false): Promise<number> => {
      await persistenceRef.current!.flush();
      if (uploaderRef.current) {
        setDraining(true);
        try {
          await uploaderRef.current.drainSession(opts.sessionId, undefined, retryExhausted);
        } finally {
          setDraining(false);
        }
      }
      const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
      setPendingCount(remaining);
      return remaining;
    },
    [opts.sessionId],
  );

  // beforeunload warning while recording — discourage accidental refresh.
  useEffect(() => {
    const needsWarning = () =>
      ['preparing', 'recording', 'pausing', 'paused', 'finishing'].includes(stateRef.current) ||
      pendingCountRef.current > 0 ||
      !!persistenceRef.current?.size;
    const handler = (e: BeforeUnloadEvent): void => {
      if (!needsWarning()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onLink = (event: MouseEvent) => {
      if (!needsWarning() || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      if (
        !link ||
        link.getAttribute('href')?.startsWith('#') ||
        link.getAttribute('target') === '_blank'
      )
        return;
      if (
        !window.confirm(
          'Capture or recording uploads are unfinished. Stay here to stop and finish saving. Leave anyway?',
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('click', onLink, true);
    return () => {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('click', onLink, true);
    };
  }, []);

  // Teardown on unmount.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      // Invalidate pending permission requests synchronously. When navigating
      // inside the app, make a best-effort tail save before releasing capture.
      void stopInternal().catch(() => {});
    };
  }, [stopInternal]);

  async function teardown(): Promise<void> {
    const worklet = workletRef.current;
    const stream = streamRef.current;
    const ctx = audioCtxRef.current;
    const decimator = decimatorRef.current;
    workletRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
    decimatorRef.current = null;
    chunkerRef.current = null;
    worklet?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    decimator?.reset();
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  return {
    state,
    error,
    lastChunkIndex,
    pendingCount,
    draining,
    startedAt,
    start,
    stop,
    pause,
    drainPending,
  };
}

export function isDisplayCaptureSupported(): boolean {
  return SUPPORTS_DISPLAY_MEDIA;
}

async function acquireStream(
  source: CaptureSource,
  externalStream?: MediaStream,
  selectedDeviceId?: string,
): Promise<MediaStream> {
  if (source === 'external') {
    if (!externalStream || externalStream.getAudioTracks().length === 0) {
      throw new Error('The call audio is not ready yet — wait for the room to connect.');
    }
    // Record owned clones: pausing capture must not stop the virtual call.
    return externalStream.clone();
  }
  if (source === 'display') {
    if (!SUPPORTS_DISPLAY_MEDIA) {
      throw new Error('Tab-audio capture is not supported in this browser.');
    }
    // Chrome requires `video: true` for tab-audio to actually flow. We
    // immediately stop the video track once the stream is acquired so
    // we never accidentally record the user's screen.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    } as DisplayMediaStreamOptions);
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio track was shared. Re-try and tick "Also share tab audio" on the share dialog.',
      );
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    return new MediaStream(stream.getAudioTracks());
  }
  // mic + dictation both use getUserMedia.
  return navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 48_000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
    },
  });
}
