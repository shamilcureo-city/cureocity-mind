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

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'finishing' | 'error';

export type CaptureSource = 'mic' | 'display' | 'dictation';

export interface RecorderOptions {
  sessionId: string;
  /** Endpoint base, defaults to '/api/v1' (same-origin). */
  scribeBase?: string;
  /** Live-stream source. 'mic' / 'dictation' use getUserMedia (mic); 'display' uses getDisplayMedia (tab/system audio for virtual sessions). */
  source: CaptureSource;
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

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const decimatorRef = useRef<PolyphaseDecimator | null>(null);
  const chunkerRef = useRef<PcmChunker | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);

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
      void drain();
    };
    window.addEventListener('online', onOnline);
    void drain();
    return () => window.removeEventListener('online', onOnline);
  }, [opts.sessionId, base, opts.getAuthToken]);

  const start = useCallback(async (): Promise<void> => {
    setState('preparing');
    setError(null);
    try {
      await requestPersistentStorage();

      const stream = await acquireStream(opts.source);
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 48_000 });
      await ctx.audioWorklet.addModule('/recorder-worklet.js');
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'cureocity-recorder');
      workletRef.current = worklet;

      const decimator = new PolyphaseDecimator(3);
      decimatorRef.current = decimator;

      const resume = await SessionStore.getCursor(opts.sessionId);
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

      const onCompletedChunk = async (chunk: PcmChunk): Promise<void> => {
        await ChunkStore.insert({
          sessionId: opts.sessionId,
          chunkIndex: chunk.chunkIndex,
          mimeType: TARGET_MIME_TYPE,
          sampleRate: TARGET_SAMPLE_RATE_HZ,
          durationMs: chunk.durationMs,
          bytes: chunk.bytes,
          enqueuedAt: chunk.startedAt,
          attempts: 0,
        });
        await SessionStore.saveCursor({
          sessionId: opts.sessionId,
          nextChunkIndex: chunkerRef.current!.nextIndex,
          startedAt: sessionStartedAt,
        });
        setLastChunkIndex(chunk.chunkIndex);
        const pending = await ChunkStore.listForSession(opts.sessionId);
        setPendingCount(pending.length);
        // Fire-and-forget drain; the outcome updates pendingCount.
        void uploader.drainSession(opts.sessionId).then(async () => {
          const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
          setPendingCount(remaining);
        });
      };

      worklet.port.onmessage = async (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (e.data.type !== 'frames' || !chunkerRef.current || !decimatorRef.current) return;
        const decimated = decimatorRef.current.process(e.data.samples);
        const completed = chunkerRef.current.push(decimated);
        for (const chunk of completed) await onCompletedChunk(chunk);
      };

      // If the user revokes the screen-share at the OS level, stop cleanly.
      stream.getTracks().forEach((t) => {
        t.addEventListener('ended', () => {
          if (state === 'recording') void stopInternal();
        });
      });

      source.connect(worklet);
      // Worklet output is unused, but the node must be connected to the
      // destination for the audio thread to schedule it.
      worklet.connect(ctx.destination);

      setState('recording');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
      await teardown();
    }
  }, [opts.sessionId, opts.source, opts.getAuthToken, base]);

  const stopInternal = useCallback(async (): Promise<void> => {
    setState('finishing');
    try {
      workletRef.current?.port.postMessage({ type: 'stop' });
      const finalChunks = chunkerRef.current?.flush() ?? [];
      for (const c of finalChunks) {
        await ChunkStore.insert({
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
      await teardown();
      if (uploaderRef.current) {
        setDraining(true);
        await uploaderRef.current.drainSession(opts.sessionId);
        setDraining(false);
      }
      const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
      setPendingCount(remaining);
      if (remaining === 0) await SessionStore.clear(opts.sessionId);
      setState('idle');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }, [opts.sessionId]);

  // Stable wrapper for the consumer.
  const stop = useCallback(() => stopInternal(), [stopInternal]);

  // beforeunload warning while recording — discourage accidental refresh.
  useEffect(() => {
    if (state !== 'recording') return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, []);

  async function teardown(): Promise<void> {
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
    chunkerRef.current = null;
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
  };
}

export function isDisplayCaptureSupported(): boolean {
  return SUPPORTS_DISPLAY_MEDIA;
}

async function acquireStream(source: CaptureSource): Promise<MediaStream> {
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
    },
  });
}
