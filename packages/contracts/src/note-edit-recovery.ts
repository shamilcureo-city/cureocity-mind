import { z } from 'zod';

// Autosave may contain incomplete prose, but never extra clinical/safety keys.
const field = z.string().max(20_000);
export const NoteEditRecoveryTreatmentFieldsSchema = z
  .object({
    subjective: field,
    objective: field,
    assessment: field,
    plan: field,
  })
  .strict();
export const NoteEditRecoveryIntakeFieldsSchema = z
  .object({
    presentingConcerns: field,
    historyOfPresentingIllness: field,
    pastPsychiatricHistory: field,
    familyHistory: field,
    socialHistory: field,
    mentalStatusExam: field,
    workingHypothesis: field,
    immediatePlan: field,
  })
  .strict();

const boundedFields = <T extends { fields: Record<string, string> }>(value: T) =>
  Object.values(value.fields).reduce((total, text) => total + text.length, 0) <= 100_000;
const fieldLimit = { message: 'Recovery clinical fields exceed the total character limit' };
const checkpoint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('INTAKE'), fields: NoteEditRecoveryIntakeFieldsSchema }).strict(),
  z
    .object({ kind: z.literal('TREATMENT'), fields: NoteEditRecoveryTreatmentFieldsSchema })
    .strict(),
]);
export const NoteEditRecoveryFieldsSchema = checkpoint.refine(boundedFields, fieldLimit);

const mutation = {
  revision: z.number().int().min(0).max(2_147_483_646),
  mutationId: z.string().uuid().toLowerCase(),
};
const base = { ...mutation, baseUpdatedAt: z.string().datetime() };
export const PutNoteEditRecoveryInputSchema = z
  .discriminatedUnion('kind', [
    z
      .object({ ...base, kind: z.literal('INTAKE'), fields: NoteEditRecoveryIntakeFieldsSchema })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal('TREATMENT'),
        fields: NoteEditRecoveryTreatmentFieldsSchema,
      })
      .strict(),
  ])
  .refine(boundedFields, fieldLimit);
export const DeleteNoteEditRecoveryInputSchema = z.object(mutation).strict();

const revision = z.number().int().min(0).max(2_147_483_647);
export const PutNoteEditRecoveryResponseSchema = z.object({
  revision,
  updatedAt: z.string().datetime(),
});
export const DeleteNoteEditRecoveryResponseSchema = z.object({ revision });
export const GetNoteEditRecoveryResponseSchema = z.object({
  revision,
  recovery: z
    .object({
      kind: z.enum(['INTAKE', 'TREATMENT']),
      fields: z.record(z.string()),
      baseUpdatedAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .nullable(),
  stale: z.boolean(),
});
export type PutNoteEditRecoveryInput = z.infer<typeof PutNoteEditRecoveryInputSchema>;
