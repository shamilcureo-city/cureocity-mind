import { z } from 'zod';
import { InstrumentKeySchema, InstrumentResponseMapSchema } from './instrument';

// Only the curated English instrument catalogue is available today. Drafts
// retain partial answers but are never treated as scored administrations.
export const MindInstrumentDraftInputSchema = z
  .object({
    operation: z.enum(['SAVE', 'DISCARD', 'SUBMIT']),
    mutationId: z.string().uuid(),
    expectedRevision: z.number().int().min(0).max(2_000_000_000),
    responses: InstrumentResponseMapSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation === 'SAVE' && value.responses === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['responses'],
        message: 'Answers are required to save a draft.',
      });
    if (value.operation !== 'SAVE' && value.responses !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['responses'],
        message: 'Submit or discard the saved revision, not a different answer set.',
      });
  });
export type MindInstrumentDraftInput = z.infer<typeof MindInstrumentDraftInputSchema>;

export const MindInstrumentDraftStateSchema = z.object({
  instrumentKey: InstrumentKeySchema,
  language: z.literal('en'),
  revision: z.number().int().nonnegative(),
  status: z.enum(['ACTIVE', 'SUBMITTED', 'DISCARDED']),
  responses: InstrumentResponseMapSchema,
  updatedAt: z.string().datetime().nullable(),
  submittedResponseId: z.string().nullable(),
  riskFlagged: z.boolean(),
});
export type MindInstrumentDraftState = z.infer<typeof MindInstrumentDraftStateSchema>;
