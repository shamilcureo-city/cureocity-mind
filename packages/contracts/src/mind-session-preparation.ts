import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import { SessionStatusSchema } from './briefing';

const PreparationId = z.string().min(1).max(200);
const PreparationFocus = z.string().trim().min(1).max(200);
const PreparationRevision = z.number().int().positive().max(2_147_483_647);

/** Confirmed preparation for one exact visit; never evidence of delivered care. */
export const MindSessionPreparationBodySchema = z
  .object({
    version: z.literal(1),
    focus: PreparationFocus.nullable(),
    source: z.literal('CLINICIAN_WRITTEN'),
    scheduledAt: IsoDateTimeSchema,
  })
  .strict();
export type MindSessionPreparationBody = z.infer<typeof MindSessionPreparationBodySchema>;

export const SaveMindSessionPreparationInputSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedClientId: PreparationId,
    expectedRevision: z.number().int().nonnegative().max(2_147_483_646),
    expectedScheduledAt: IsoDateTimeSchema.transform((value) => new Date(value).toISOString()),
    action: z.enum(['SAVE', 'CLEAR']),
    focus: PreparationFocus.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.action === 'CLEAR') !== (input.focus === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['focus'],
        message: 'Save requires a focus; clear requires null.',
      });
    }
  });
export type SaveMindSessionPreparationInput = z.infer<typeof SaveMindSessionPreparationInputSchema>;

export const MindSessionPreparationSchema = z
  .object({
    id: PreparationId,
    sessionId: PreparationId,
    psychologistId: PreparationId,
    revision: PreparationRevision,
    operationId: z.string().uuid(),
    body: MindSessionPreparationBodySchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type MindSessionPreparation = z.infer<typeof MindSessionPreparationSchema>;

const VisitIdentity = {
  sessionId: PreparationId,
  clientId: PreparationId,
  scheduledAt: IsoDateTimeSchema,
  status: SessionStatusSchema,
};

export const MindSessionPreparationResponseSchema = z
  .object({
    ...VisitIdentity,
    preparation: MindSessionPreparationSchema.nullable(),
  })
  .strict();
export type MindSessionPreparationResponse = z.infer<typeof MindSessionPreparationResponseSchema>;

export const MindSessionPreparationSaveResponseSchema = z
  .object({
    ...VisitIdentity,
    preparation: MindSessionPreparationSchema,
    currentRevision: PreparationRevision,
    replayed: z.boolean(),
  })
  .strict();
export type MindSessionPreparationSaveResponse = z.infer<
  typeof MindSessionPreparationSaveResponseSchema
>;
