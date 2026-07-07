'use client';

import {
  PcmChunker,
  PolyphaseDecimator,
  SilenceTrimmer,
  TARGET_MIME_TYPE,
  TARGET_SAMPLE_RATE_HZ,
  float32ToInt16Le,
  type PcmChunk,
  type SilenceTrimOptions,
} from '@cureocity/audio';
import { ChunkStore, SessionStore } from './idb-chunk-store';
import { ChunkUploader } from './chunk-uploader';
import { requestPersistentStorage } from './storage-buckets';

export interface FileUploadOptions {
  sessionId: string;
  file: File;
  scribeBase?: string;
  getAuthToken?: () => Promise<string | null>;
  onProgress?: (info: { decoded: number; total: number; chunksUploaded: number }) => void;
}

export interface FileUploadResult {
  chunksWritten: number;
  durationMs: number;
}

/**
 * Decodes an uploaded audio file (any browser-supported codec — wav, mp3,
 * m4a, webm/opus, flac), downmixes to mono, resamples to 16 kHz via the
 * same PolyphaseDecimator used for live capture (when the source rate
 * is a 48 kHz multiple) or via a fallback linear path, chunks into the
 * same 30-second PcmChunks, and pushes them through the same uploader.
 *
 * The decoder runs in the main thread via OfflineAudioContext, which
 * also handles resampling natively when the source rate differs from
 * the target context rate.
 */
export async function uploadAudioFile(opts: FileUploadOptions): Promise<FileUploadResult> {
  await requestPersistentStorage();

  const arrayBuffer = await opts.file.arrayBuffer();
  const decodeCtx = new (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  )();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  await decodeCtx.close();

  // Render to 48 kHz mono via OfflineAudioContext so the polyphase
  // decimator (3:1, 48->16) sees the input it was tuned for.
  const targetMidRate = 48_000;
  const totalSamplesAtMid = Math.ceil(decoded.duration * targetMidRate);
  const offline = new OfflineAudioContext({
    numberOfChannels: 1,
    length: totalSamplesAtMid,
    sampleRate: targetMidRate,
  });
  const src = offline.createBufferSource();
  src.buffer = decoded;
  // Downmix to mono by averaging channels through a merger->splitter
  // chain is not strictly necessary; connecting a multi-channel buffer
  // into a 1-channel destination uses the default down-mix rules.
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const monoMid = rendered.getChannelData(0);

  const sessionStartedAt = Date.now();
  await SessionStore.saveCursor({
    sessionId: opts.sessionId,
    nextChunkIndex: 0,
    startedAt: sessionStartedAt,
  });

  const decimator = new PolyphaseDecimator(3);
  const chunker = new PcmChunker({ sessionStartedAt, initialChunkIndex: 0 });
  // Sprint 77 — optional voice-activity silence trim (Pass 1 audio diet).
  // DEFAULT OFF: the energy threshold is device-dependent, so it stays behind
  // a build-time flag until a transcript-fidelity spot-check passes. When off,
  // this is a byte-for-byte no-op (the trimmer is never constructed).
  const trimmer = resolveSilenceTrimmer();
  const uploader = new ChunkUploader({
    scribeBase: opts.scribeBase ?? '/api/v1',
    ...(opts.getAuthToken && { getAuthToken: opts.getAuthToken }),
  });

  // Pump samples in ~10 s slices to keep the main thread responsive
  // and let the UI tick progress.
  const SLICE = targetMidRate * 10;
  let cursor = 0;
  let chunksWritten = 0;
  const completedChunks: PcmChunk[] = [];

  while (cursor < monoMid.length) {
    const end = Math.min(cursor + SLICE, monoMid.length);
    const slice = monoMid.subarray(cursor, end);
    const decimated = decimator.process(slice);
    const forChunker = trimmer ? trimmer.process(decimated) : decimated;
    completedChunks.push(...chunker.push(forChunker));
    cursor = end;
    opts.onProgress?.({
      decoded: cursor,
      total: monoMid.length,
      chunksUploaded: chunksWritten,
    });
    // Yield to the event loop occasionally.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (trimmer) {
    // Flush any retained silence held by the trimmer BEFORE flushing the
    // chunker, so the final partial chunk includes it.
    const tail = trimmer.flush();
    if (tail.length) completedChunks.push(...chunker.push(tail));
    const s = trimmer.getStats();
    const pct = s.inputSamples > 0 ? Math.round((s.droppedSamples / s.inputSamples) * 100) : 0;
    console.info(
      `[upload-file] silence trim: dropped ${pct}% of audio ` +
        `(${s.droppedSamples}/${s.inputSamples} samples)`,
    );
  }
  for (const c of chunker.flush()) completedChunks.push(c);

  // Persist + upload each chunk in order so the uploader can drain
  // serially. We avoid re-encoding (float32ToInt16Le already happened
  // inside the chunker via its internal buffer copy in the
  // packages/audio implementation — but for safety, the chunker stores
  // int16 bytes directly per its contract).
  for (const chunk of completedChunks) {
    // PcmChunker emits 16-bit int LE PCM bytes per its type contract;
    // belt-and-braces re-encode in case a future change relaxes that.
    const bytes =
      chunk.bytes instanceof Uint8Array
        ? chunk.bytes
        : float32ToInt16Le(chunk.bytes as unknown as Float32Array);
    await ChunkStore.insert({
      sessionId: opts.sessionId,
      chunkIndex: chunk.chunkIndex,
      mimeType: TARGET_MIME_TYPE,
      sampleRate: TARGET_SAMPLE_RATE_HZ,
      durationMs: chunk.durationMs,
      bytes,
      enqueuedAt: chunk.startedAt,
      attempts: 0,
    });
    chunksWritten += 1;
    opts.onProgress?.({
      decoded: monoMid.length,
      total: monoMid.length,
      chunksUploaded: chunksWritten,
    });
  }

  await uploader.drainSession(opts.sessionId);

  const remaining = (await ChunkStore.listForSession(opts.sessionId)).length;
  if (remaining === 0) await SessionStore.clear(opts.sessionId);

  return {
    chunksWritten,
    durationMs: Math.round(decoded.duration * 1000),
  };
}

/**
 * Sprint 77 — build a SilenceTrimmer only when the build-time flag is set.
 * Returns null (a no-op) by default. The energy threshold is
 * microphone/room dependent, so the flag stays off until a transcript-
 * fidelity spot-check on real uploads passes. Thresholds are overridable
 * via env for tuning that spot-check.
 */
function resolveSilenceTrimmer(): SilenceTrimmer | null {
  if (process.env['NEXT_PUBLIC_AUDIO_SILENCE_TRIM'] !== 'true') return null;
  const opts: SilenceTrimOptions = { sampleRate: TARGET_SAMPLE_RATE_HZ };
  const threshold = numEnv('NEXT_PUBLIC_AUDIO_SILENCE_THRESHOLD_RMS');
  const minSilence = numEnv('NEXT_PUBLIC_AUDIO_SILENCE_MIN_MS');
  const padding = numEnv('NEXT_PUBLIC_AUDIO_SILENCE_PADDING_MS');
  if (threshold !== null) opts.thresholdRms = threshold;
  if (minSilence !== null) opts.minSilenceMs = minSilence;
  if (padding !== null) opts.paddingMs = padding;
  return new SilenceTrimmer(opts);
}

function numEnv(key: string): number | null {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
