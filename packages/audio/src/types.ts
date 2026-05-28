/**
 * Audio capture primitives.
 *
 * V1 pipeline:
 *   getUserMedia (48 kHz, 1 ch)
 *     → AudioWorklet (PassThrough)
 *     → polyphase FIR decimator (48 → 16 kHz)
 *     → Float32 → Int16 quantiser
 *     → chunker (30 s windows)
 *     → IndexedDB persistence + multipart POST to scribe-service
 *
 * Sample rates are FIXED at 48 kHz input / 16 kHz output for V1. This
 * matches Gemini Flash's preferred audio bitrate and minimises chunk
 * sizes (16-bit mono PCM at 16 kHz = 32 KB/sec).
 */

export const TARGET_SAMPLE_RATE_HZ = 16_000;
export const SOURCE_SAMPLE_RATE_HZ = 48_000;
export const DECIMATION_FACTOR = SOURCE_SAMPLE_RATE_HZ / TARGET_SAMPLE_RATE_HZ; // 3
export const TARGET_BIT_DEPTH = 16;
export const TARGET_MIME_TYPE = `audio/pcm;rate=${TARGET_SAMPLE_RATE_HZ}`;

export interface PcmChunk {
  /** Monotonic counter, 0-based, assigned by the chunker. */
  chunkIndex: number;
  /** Wall-clock time when the first sample was captured. */
  startedAt: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Number of mono samples at TARGET_SAMPLE_RATE_HZ. */
  sampleCount: number;
  /** 16-bit signed little-endian PCM bytes — ready to POST. */
  bytes: Uint8Array;
}

/** Chunk window length, default 30s. */
export const DEFAULT_CHUNK_SECONDS = 30;
