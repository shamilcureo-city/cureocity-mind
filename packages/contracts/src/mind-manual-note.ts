import { z } from 'zod';
import { IntakeNoteV1Schema, TherapyNoteV1Schema, RiskSeveritySchema } from './note';
import { MindSessionPurposeSchema } from './session';
import { SessionModalitySchema } from './client';

const text = z.string().max(6000);
export const MindManualNoteFieldsSchema = z
  .object({
    presentingConcerns: text.default(''),
    historyOfPresentingIllness: text.default(''),
    pastPsychiatricHistory: text.default(''),
    familyHistory: text.default(''),
    socialHistory: text.default(''),
    mentalStatusExam: text.default(''),
    workingHypothesis: text.default(''),
    immediatePlan: text.default(''),
    subjective: text.default(''),
    objective: text.default(''),
    assessment: text.default(''),
    plan: text.default(''),
    riskSeverity: RiskSeveritySchema.nullable().default(null),
    riskDetails: text.default(''),
  })
  .strict();
export type MindManualNoteFields = z.infer<typeof MindManualNoteFieldsSchema>;
export const MindManualStartInputSchema = z
  .object({
    operation: z.literal('start'),
    expectedUpdatedAt: z.string().datetime(),
    mindPurpose: MindSessionPurposeSchema.optional(),
  })
  .strict();
export const MindManualWriteInputSchema = z
  .object({
    operation: z.enum(['save', 'complete']),
    expectedRevision: z.number().int().min(0).max(2_147_483_646),
    expectedNoteUpdatedAt: z.string().datetime().nullable(),
    mutationId: z.string().uuid(),
    fields: MindManualNoteFieldsSchema,
  })
  .strict();
export const MindManualNoteInputSchema = z.union([
  MindManualStartInputSchema,
  MindManualWriteInputSchema,
]);

/** No generated clinical facts, evidence, diagnoses or risk level defaults. */
export function canonicalMindManualNote(
  kind: string,
  modality: z.infer<typeof SessionModalitySchema> | null,
  fields: MindManualNoteFields,
) {
  if (fields.riskSeverity === null)
    throw new Error('Record your safety assessment before completing the note.');
  if (!fields.riskDetails.trim())
    throw new Error('Document what was assessed, any uncertainty and relevant safety actions.');
  const riskFlags = {
    severity: fields.riskSeverity,
    indicators: [],
    details: fields.riskDetails.trim(),
  };
  return kind === 'INTAKE'
    ? IntakeNoteV1Schema.parse({
        version: 'V1',
        presentingConcerns: fields.presentingConcerns.trim(),
        historyOfPresentingIllness: fields.historyOfPresentingIllness.trim(),
        pastPsychiatricHistory: fields.pastPsychiatricHistory.trim(),
        familyHistory: fields.familyHistory.trim(),
        socialHistory: fields.socialHistory.trim(),
        mentalStatusExam: fields.mentalStatusExam.trim(),
        workingHypothesis: fields.workingHypothesis.trim(),
        immediatePlan: fields.immediatePlan.trim(),
        riskFlags,
        linkedEvidence: [],
      })
    : TherapyNoteV1Schema.parse({
        version: 'V1',
        modality: modality ?? 'SUPPORTIVE',
        subjective: fields.subjective.trim(),
        objective: fields.objective.trim(),
        assessment: fields.assessment.trim(),
        plan: fields.plan.trim(),
        riskFlags,
        linkedEvidence: [],
        phaseHints: [],
      });
}
