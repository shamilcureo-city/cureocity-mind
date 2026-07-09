import { describe, expect, it, vi } from 'vitest';
import { flushPendingWithRetries } from './flush-pending';

const noSleep = () => Promise.resolve();

describe('flushPendingWithRetries (FLOW-2)', () => {
  it('returns 0 immediately when the first drain empties the queue', async () => {
    const drainOnce = vi.fn(async () => 0);
    const remaining = await flushPendingWithRetries(drainOnce, { sleep: noSleep });
    expect(remaining).toBe(0);
    expect(drainOnce).toHaveBeenCalledTimes(1); // no retry needed
  });

  it('retries until the queue drains, then stops', async () => {
    const counts = [3, 2, 0]; // drains to empty on the 3rd pass
    let i = 0;
    const drainOnce = vi.fn(async () => counts[i++]!);
    const progress: Array<[number, number]> = [];
    const remaining = await flushPendingWithRetries(drainOnce, {
      sleep: noSleep,
      onProgress: (r, a) => progress.push([r, a]),
    });
    expect(remaining).toBe(0);
    expect(drainOnce).toHaveBeenCalledTimes(3);
    // stops the moment it hits 0 — no wasted 4th/5th attempt
    expect(progress).toEqual([
      [3, 1],
      [2, 2],
      [0, 3],
    ]);
  });

  it('gives up after maxAttempts and reports the leftover count', async () => {
    const drainOnce = vi.fn(async () => 2); // never drains
    const remaining = await flushPendingWithRetries(drainOnce, {
      sleep: noSleep,
      maxAttempts: 4,
    });
    expect(remaining).toBe(2); // caller must warn / confirm before generating
    expect(drainOnce).toHaveBeenCalledTimes(4);
  });

  it('waits delayMs between passes (only between, not before the first/after the last)', async () => {
    const counts = [1, 1, 0];
    let i = 0;
    const drainOnce = async () => counts[i++]!;
    const sleeps: number[] = [];
    await flushPendingWithRetries(drainOnce, {
      delayMs: 1500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([1500, 1500]); // 3 passes → 2 inter-pass waits
  });
});
