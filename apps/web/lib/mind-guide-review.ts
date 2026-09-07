import { z } from 'zod';

// Cursor/review metadata only. Suitability, delivered therapy and clinical
// decisions are deliberately absent and cannot be inferred from these fields.
export const MindGuideReviewSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    scriptUpdatedAt: z.string().datetime(),
    activeIndex: z.number().int().min(0).max(17),
    reviewedIndexes: z.array(z.number().int().min(0).max(17)).max(18),
  })
  .strict();
export type MindGuideReview = z.infer<typeof MindGuideReviewSchema>;
export const MindGuideReviewUpdateSchema = MindGuideReviewSchema.omit({ revision: true })
  .extend({
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export type MindGuideReviewSnapshot = Omit<MindGuideReview, 'revision'>;

export function readGuideReview(
  value: unknown,
  scriptUpdatedAt: string,
  stepCount: number,
): MindGuideReview | null {
  const parsed = MindGuideReviewSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.scriptUpdatedAt !== scriptUpdatedAt ||
    parsed.data.activeIndex >= stepCount ||
    parsed.data.reviewedIndexes.some((index) => index >= stepCount)
  )
    return null;
  return {
    ...parsed.data,
    reviewedIndexes: [...new Set(parsed.data.reviewedIndexes)].sort((a, b) => a - b),
  };
}

export function sameGuideReviewSnapshot(
  left: MindGuideReviewSnapshot,
  right: MindGuideReviewSnapshot,
): boolean {
  return (
    left.scriptUpdatedAt === right.scriptUpdatedAt &&
    left.activeIndex === right.activeIndex &&
    left.reviewedIndexes.length === right.reviewedIndexes.length &&
    left.reviewedIndexes.every((index, position) => index === right.reviewedIndexes[position])
  );
}

/** Serial checkpoints, coalescing waiting navigation into its latest snapshot.
 * An uncertain failure stops all waiting writes until the caller reconciles it. */
export function createGuideReviewQueue<T>(write: (value: T) => Promise<void>) {
  type Waiter = { resolve: () => void; reject: (error: unknown) => void };
  let pending: { value: T; waiters: Waiter[] } | null = null;
  let running = false;
  let cancelled = false;
  async function drain() {
    if (running) return;
    running = true;
    while (pending && !cancelled) {
      const batch = pending;
      pending = null;
      try {
        await write(batch.value);
        batch.waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        batch.waiters.forEach(({ reject }) => reject(error));
        const waiting = pending as { value: T; waiters: Waiter[] } | null;
        pending = null;
        waiting?.waiters.forEach(({ reject }) => reject(error));
        break;
      }
    }
    running = false;
  }
  const enqueue = (value: T): Promise<void> => {
    if (cancelled) return Promise.reject(new Error('Guide view closed.'));
    const result = new Promise<void>((resolve, reject) => {
      if (pending) {
        pending.value = value;
        pending.waiters.push({ resolve, reject });
      } else pending = { value, waiters: [{ resolve, reject }] };
    });
    void drain();
    return result;
  };
  return Object.assign(enqueue, {
    cancel: () => {
      cancelled = true;
      pending?.waiters.forEach(({ reject }) => reject(new Error('Guide view closed.')));
      pending = null;
    },
  });
}
