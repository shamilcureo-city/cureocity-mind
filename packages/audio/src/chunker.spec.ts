import { describe, it, expect } from 'vitest';
import { PcmChunker } from './chunker';
import { TARGET_SAMPLE_RATE_HZ } from './types';

describe('PcmChunker', () => {
  const START = 1_700_000_000_000;

  it('emits a chunk when the buffer fills', () => {
    const chunker = new PcmChunker({ sessionStartedAt: START, chunkSeconds: 1 });
    const oneSecond = TARGET_SAMPLE_RATE_HZ; // 16 000 samples
    const out = chunker.push(new Float32Array(oneSecond).fill(0.5));
    expect(out).toHaveLength(1);
    expect(out[0]!.chunkIndex).toBe(0);
    expect(out[0]!.sampleCount).toBe(oneSecond);
    expect(out[0]!.durationMs).toBe(1000);
    // 16 bits per sample => 32000 bytes for 16k samples
    expect(out[0]!.bytes.byteLength).toBe(oneSecond * 2);
  });

  it('does not emit when buffer is under-filled', () => {
    const chunker = new PcmChunker({ sessionStartedAt: START, chunkSeconds: 1 });
    const half = TARGET_SAMPLE_RATE_HZ / 2;
    const out = chunker.push(new Float32Array(half).fill(0.5));
    expect(out).toEqual([]);
  });

  it('splits a long push into multiple chunks with monotonic indexes', () => {
    const chunker = new PcmChunker({ sessionStartedAt: START, chunkSeconds: 1 });
    const threeSeconds = TARGET_SAMPLE_RATE_HZ * 3;
    const out = chunker.push(new Float32Array(threeSeconds).fill(0.1));
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('flush() returns the final partial chunk', () => {
    const chunker = new PcmChunker({ sessionStartedAt: START, chunkSeconds: 1 });
    const half = TARGET_SAMPLE_RATE_HZ / 2;
    chunker.push(new Float32Array(half));
    const out = chunker.flush();
    expect(out).toHaveLength(1);
    expect(out[0]!.sampleCount).toBe(half);
    expect(out[0]!.durationMs).toBe(500);
  });

  it('flush() on empty buffer returns []', () => {
    const chunker = new PcmChunker({ sessionStartedAt: START, chunkSeconds: 1 });
    expect(chunker.flush()).toEqual([]);
  });

  it('initialChunkIndex resumes from a saved offset (gap G2)', () => {
    const chunker = new PcmChunker({
      sessionStartedAt: START,
      chunkSeconds: 1,
      initialChunkIndex: 5,
    });
    const out = chunker.push(new Float32Array(TARGET_SAMPLE_RATE_HZ));
    expect(out[0]!.chunkIndex).toBe(5);
    expect(chunker.nextIndex).toBe(6);
  });
});
