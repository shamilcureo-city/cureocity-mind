import { z } from 'zod';

/** Existing callers keep the legacy apply behavior; Mind explicitly requests a
 * version-bound preview, then uses the guarded canonical draft editor to apply. */
export const ModifyNoteInputSchema = z
  .object({
    instruction: z.string().trim().min(3).max(1000),
    mode: z.enum(['APPLY', 'PREVIEW']).default('APPLY'),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'PREVIEW' && !value.expectedUpdatedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedUpdatedAt'],
        message: 'A preview requires the current draft version.',
      });
    }
  });
