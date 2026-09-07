import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createGuideReviewQueue,
  MindGuideReviewSchema,
  readGuideReview,
  sameGuideReviewSnapshot,
} from './mind-guide-review';

const progress = {
  version: 1 as const,
  scriptUpdatedAt: '2026-09-06T10:00:00.000Z',
  activeIndex: 2,
  reviewedIndexes: [1, 0, 1],
};

describe('guide review is version-bound UI metadata', () => {
  it('bounds both HTTP operations while keeping timeout distinct from lifecycle cancellation', () => {
    const hook = readFileSync(new URL('./use-mind-guide-review.ts', import.meta.url), 'utf8');
    expect(hook.match(/AbortSignal\.timeout\(20_000\)/g)).toHaveLength(2);
    expect(hook.match(/AbortSignal\.any\(/g)).toHaveLength(2);
    expect(hook).toContain('controller.signal.aborted');
    expect(hook).toContain("setSaveStatus('load-error')");
    expect(hook).toContain("error.status : 'save-error'");
  });
  it('normalizes indexes without recording clinical completion', () => {
    expect(readGuideReview(progress, progress.scriptUpdatedAt, 6)).toEqual({
      ...progress,
      revision: 0,
      reviewedIndexes: [0, 1],
    });
    expect(MindGuideReviewSchema.safeParse({ ...progress, therapyDelivered: true }).success).toBe(
      false,
    );
    expect(MindGuideReviewSchema.safeParse({ ...progress, suitable: true }).success).toBe(false);
  });
  it('rejects stale, invalid, out-of-range and malformed cursors', () => {
    for (const value of [
      null,
      {},
      { ...progress, version: 2 },
      { ...progress, activeIndex: -1 },
      { ...progress, activeIndex: 6 },
      { ...progress, reviewedIndexes: [6] },
      { ...progress, scriptUpdatedAt: '2025-01-01T00:00:00.000Z' },
    ]) {
      expect(readGuideReview(value, progress.scriptUpdatedAt, 6)).toBeNull();
    }
  });
  it('serializes writes so a slow old cursor cannot overwrite a new one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const committed: number[] = [];
    const write = vi.fn(async (value: typeof progress) => {
      if (value.activeIndex === 0) await gate;
      committed.push(value.activeIndex);
    });
    const queue = createGuideReviewQueue(write);
    const first = queue({ ...progress, activeIndex: 0 });
    const second = queue({ ...progress, activeIndex: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(committed).toEqual([0, 1]);
  });
  it('allows an explicit new snapshot after a failed write', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = createGuideReviewQueue(write);
    await expect(queue(progress)).rejects.toThrow('offline');
    await expect(queue({ ...progress, activeIndex: 3 })).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('coalesces rapid reading checkpoints while a slow save is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const committed: number[] = [];
    const queue = createGuideReviewQueue(async (value: typeof progress) => {
      if (value.activeIndex === 0) await gate;
      committed.push(value.activeIndex);
    });
    const first = queue({ ...progress, activeIndex: 0 });
    const second = queue({ ...progress, activeIndex: 1 });
    const third = queue({ ...progress, activeIndex: 3 });
    release();
    await Promise.all([first, second, third]);
    expect(committed).toEqual([0, 3]);
  });
  it('does not send waiting checkpoints after an uncertain failure', async () => {
    let fail!: (error: Error) => void;
    const gate = new Promise<void>((_, reject) => {
      fail = reject;
    });
    const write = vi.fn(() => gate);
    const queue = createGuideReviewQueue(write);
    const result = Promise.allSettled([queue(progress), queue({ ...progress, activeIndex: 3 })]);
    fail(new Error('Lost response'));
    expect((await result).map((item) => item.status)).toEqual(['rejected', 'rejected']);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("recognizes an exact lost-response checkpoint without accepting another view's markers", () => {
    expect(sameGuideReviewSnapshot(progress, { ...progress })).toBe(true);
    expect(sameGuideReviewSnapshot(progress, { ...progress, reviewedIndexes: [0, 2] })).toBe(false);
    expect(sameGuideReviewSnapshot(progress, { ...progress, activeIndex: 3 })).toBe(false);
  });
  it('does not send queued work after its view has closed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn(async () => {
      await gate;
    });
    const queue = createGuideReviewQueue(write);
    const first = queue(progress);
    const second = queue(progress);
    const secondResult = expect(second).rejects.toThrow('Guide view closed');
    await Promise.resolve();
    await Promise.resolve();
    queue.cancel();
    release();
    await first;
    await secondResult;
    expect(write).toHaveBeenCalledTimes(1);
  });
});
