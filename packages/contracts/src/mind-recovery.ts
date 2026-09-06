import { z } from 'zod';

export const MindRecoveryUtteranceSchema = z
  .object({
    id: z.string().min(1).max(128),
    speaker: z.enum(['doctor', 'patient', 'unknown']),
    text: z.string().trim().min(1).max(10000),
    tStartMs: z.number().int().min(0).max(86_400_000),
    tEndMs: z.number().int().min(0).max(86_400_000),
  })
  .refine((row) => row.tEndMs >= row.tStartMs, 'Invalid utterance time');

export const MindRecoveryInputSchema = z
  .object({
    action: z.enum(['CONTINUE_RECORDING', 'FINALIZE']),
    utterances: z.array(MindRecoveryUtteranceSchema).min(1).max(2000),
  })
  .superRefine(({ utterances }, ctx) => {
    if (new Set(utterances.map((row) => row.id)).size !== utterances.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate utterance IDs' });
    if (utterances.reduce((n, row) => n + row.text.length, 0) > 400000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Transcript is too large' });
  });
export type MindRecoveryInput = z.infer<typeof MindRecoveryInputSchema>;
