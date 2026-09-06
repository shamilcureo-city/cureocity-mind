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

/** Serial full snapshots: an earlier slow request cannot overwrite a later step. */
export function createGuideReviewQueue<T>(write: (value: T) => Promise<void>) {
  let previous = Promise.resolve();
  let cancelled = false;
  const enqueue = (value: T): Promise<void> => {
    const next = previous
      .catch(() => undefined)
      .then(() => {
        if (cancelled) throw new Error('Guide view closed.');
        return write(value);
      });
    previous = next;
    return next;
  };
  return Object.assign(enqueue, {
    cancel: () => {
      cancelled = true;
    },
  });
}
