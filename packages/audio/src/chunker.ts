import { DEFAULT_CHUNK_SECONDS, TARGET_SAMPLE_RATE_HZ, type PcmChunk } from './types';
import { float32ToInt16Le } from './encoder';

/**
 * Slices a continuous stream of Float32 mono samples at TARGET_SAMPLE_RATE_HZ
 * into fixed-length PcmChunks.
 *
 * Use:
 *   const chunker = new PcmChunker({ sessionStartedAt: Date.now() });
 *   for each onaudio event from the worklet (already decimated to 16 kHz):
 *     for (const chunk of chunker.push(samples)) { uploadAndPersist(chunk); }
 *   // when the session ends, flush any partial chunk:
 *   for (const chunk of chunker.flush()) { uploadAndPersist(chunk); }
 *
 * Each emitted chunk is independent: its bytes can be POSTed in any
 * order; the backend orders by chunkIndex (Sprint 2 PR 4).
 */
export interface ChunkerOptions {
  /** Wall-clock millis when the FIRST audio sample was captured. */
  sessionStartedAt: number;
  /** Window length; defaults to 30s. */
  chunkSeconds?: number;
  /** Resume from an existing offset (gap G2 — session resume after refresh). */
  initialChunkIndex?: number;
}

export class PcmChunker {
  private readonly chunkSamples: number;
  private readonly sessionStartedAt: number;
  /** Accumulator for the current chunk. */
  private buffer: Float32Array;
  private bufferOffset = 0;
  private chunkIndex: number;

  constructor(opts: ChunkerOptions) {
    const seconds = opts.chunkSeconds ?? DEFAULT_CHUNK_SECONDS;
    this.chunkSamples = seconds * TARGET_SAMPLE_RATE_HZ;
    this.sessionStartedAt = opts.sessionStartedAt;
    this.buffer = new Float32Array(this.chunkSamples);
    this.chunkIndex = opts.initialChunkIndex ?? 0;
  }

  /** Returns the next chunk index that will be emitted. */
  get nextIndex(): number {
    return this.chunkIndex;
  }

  /**
   * Adds samples and yields completed chunks. Caller iterates the
   * returned array — usually 0 or 1 chunks per push.
   */
  push(samples: Float32Array): PcmChunk[] {
    const emitted: PcmChunk[] = [];
    let cursor = 0;
    while (cursor < samples.length) {
      const space = this.chunkSamples - this.bufferOffset;
      const take = Math.min(space, samples.length - cursor);
      this.buffer.set(samples.subarray(cursor, cursor + take), this.bufferOffset);
      this.bufferOffset += take;
      cursor += take;
      if (this.bufferOffset === this.chunkSamples) {
        emitted.push(this.emit(this.chunkSamples));
        this.buffer = new Float32Array(this.chunkSamples);
        this.bufferOffset = 0;
      }
    }
    return emitted;
  }

  /**
   * Returns the final partial chunk (if any). Safe to call when buffer
   * is empty — returns []. Caller should drop any zero-sample emission.
   */
  flush(): PcmChunk[] {
    if (this.bufferOffset === 0) return [];
    const partial = this.emit(this.bufferOffset);
    this.buffer = new Float32Array(this.chunkSamples);
    this.bufferOffset = 0;
    return [partial];
  }

  private emit(sampleCount: number): PcmChunk {
    const slice = this.buffer.subarray(0, sampleCount);
    const bytes = float32ToInt16Le(slice);
    const durationMs = Math.round((sampleCount / TARGET_SAMPLE_RATE_HZ) * 1000);
    const startedAt =
      this.sessionStartedAt +
      Math.round((this.chunkIndex * this.chunkSamples) / TARGET_SAMPLE_RATE_HZ) * 1000;
    const chunk: PcmChunk = {
      chunkIndex: this.chunkIndex,
      startedAt,
      durationMs,
      sampleCount,
      bytes,
    };
    this.chunkIndex += 1;
    return chunk;
  }
}
