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

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'paused' | 'finishing' | 'error';

export interface RecorderOptions {
  sessionId: string;
  scribeBase: string;
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
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Drives the full session-capture pipeline:
 *
 *   1. requestPersistentStorage() (Storage Buckets / persist())
 *   2. getUserMedia({ audio: { sampleRate: 48000, channelCount: 1 } })
 *   3. AudioContext + AudioWorklet (cureocity-recorder, /public/recorder-worklet.js)
 *   4. Worklet posts Float32 frames at 48 kHz
 *   5. Main thread: PolyphaseDecimator → PcmChunker → PersistedChunk
 *   6. ChunkUploader.drainSession() POSTs to scribe-service
 *   7. SessionStore.saveCursor() after each chunk for resume
 *
 * Session-resume (gap G2): on mount with a sessionId that has a saved
 * cursor in SessionStore, we resume the chunkIndex from there. The
 * 200-500 ms gap mentioned in the plan is the time between the user
 * re-granting mic permission and the worklet's first frame.
 */
export function useSessionRecorder(opts: RecorderOptions): RecorderHandle {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastChunkIndex, setLastChunkIndex] = useState(-1);
  const [pendingCount, setPendingCount] = useState(0);
  const [draining, setDraining] = useState(false);

  // Long-lived refs that survive renders but reset on unmount.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const decimatorRef = useRef<PolyphaseDecimator | null>(null);
  const chunkerRef = useRef<PcmChunker | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);

  // Drain queued chunks on `online` event.
  useEffect(() => {
    const drain = async (): Promise<void> => {
      if (!uploaderRef.current) return;
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
  }, [opts.sessionId]);

  const start = useCallback(async (): Promise<void> => {
    setState('preparing');
    setError(null);
    try {
      await requestPersistentStorage();

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

      const resume = await SessionStore.getCursor(opts.sessionId);
      const chunker = new PcmChunker({
        sessionStartedAt: resume?.startedAt ?? Date.now(),
        initialChunkIndex: resume?.nextChunkIndex ?? 0,
      });
      chunkerRef.current = chunker;

      const uploader = new ChunkUploader({
        scribeBase: opts.scribeBase,
        ...(opts.getAuthToken && { getAuthToken: opts.getAuthToken }),
      });
      uploaderRef.current = uploader;

      worklet.port.onmessage = async (e: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (e.data.type !== 'frames' || !chunkerRef.current || !decimatorRef.current) return;
        const decimated = decimatorRef.current.process(e.data.samples);
        const completed = chunkerRef.current.push(decimated);
        for (const chunk of completed) await onCompletedChunk(chunk);
      };

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
          startedAt: resume?.startedAt ?? Date.now(),
        });
        setLastChunkIndex(chunk.chunkIndex);
        // Fire-and-forget drain; the outcome updates pendingCount.
        void uploaderRef.current!.drainSession(opts.sessionId).then(async () => {
          const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
          setPendingCount(remaining);
        });
      };

      source.connect(worklet);
      // Worklet output is unused — we don't render audio back; but the
      // graph node must be connected for AudioWorklet to schedule.
      worklet.connect(ctx.destination);

      setState('recording');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
      await teardown();
    }
  }, [opts.sessionId, opts.scribeBase, opts.getAuthToken]);

  const stop = useCallback(async (): Promise<void> => {
    setState('finishing');
    try {
      // Send 'stop' so the worklet halts on its own audio tick.
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
    start,
    stop,
  };
}
