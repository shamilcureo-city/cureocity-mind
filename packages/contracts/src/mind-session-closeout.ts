import { z } from 'zod';

export const MindCloseoutStepStateSchema = z.enum(['PENDING', 'COMPLETE', 'SKIPPED']);

export const MindSessionCloseoutSchema = z.object({
  product: z.literal('MIND'),
  status: z.enum(['GENERATING', 'NEEDS_ATTENTION', 'REVIEW_AND_CLOSE', 'COMPLETE']),
  steps: z.object({
    noteGenerated: MindCloseoutStepStateSchema,
    noteReviewed: MindCloseoutStepStateSchema,
    clinicalSuggestions: MindCloseoutStepStateSchema,
    agreements: MindCloseoutStepStateSchema,
    nextSessionQuestions: MindCloseoutStepStateSchema,
    signed: MindCloseoutStepStateSchema,
    shared: MindCloseoutStepStateSchema,
    followUp: MindCloseoutStepStateSchema,
  }),
});

export type MindCloseoutStepState = z.infer<typeof MindCloseoutStepStateSchema>;
export type MindSessionCloseout = z.infer<typeof MindSessionCloseoutSchema>;
