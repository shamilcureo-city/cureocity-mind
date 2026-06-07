import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 22 — the "running differential".
 *
 * A persisted, trackable diagnostic / assessment question. Generated
 * from Pass 3 output (the brief's assessmentGaps + each diagnosis
 * candidate's gapsToFill) and carried forward across sessions until the
 * therapist resolves it. The set of OPEN items is the "what to ask next
 * session" surface — the structured-interview logic of continually
 * testing diagnostic hypotheses, made durable.
 */

export const AssessmentItemStatusSchema = z.enum(['OPEN', 'ADDRESSED', 'CLOSED']);
export type AssessmentItemStatus = z.infer<typeof AssessmentItemStatusSchema>;

export const AssessmentItemKindSchema = z.enum([
  'DIAGNOSTIC_CRITERION', // tests an ICD-11 criterion (from candidate gapsToFill)
  'ASSESSMENT_GAP', // general information still needed (from report assessmentGaps)
  'INSTRUMENT', // administer a scored screener
  'SAFETY', // safety / risk assessment to complete
]);
export type AssessmentItemKind = z.infer<typeof AssessmentItemKindSchema>;

export const AssessmentItemSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  episodeId: CuidSchema.nullable(),
  kind: AssessmentItemKindSchema,
  question: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
  icd11Code: z.string().nullable(),
  status: AssessmentItemStatusSchema,
  sourceSessionId: CuidSchema.nullable(),
  addressedSessionId: CuidSchema.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
});
export type AssessmentItem = z.infer<typeof AssessmentItemSchema>;

/**
 * PATCH /api/v1/clients/[id]/assessment-items/[itemId].
 * Status-only transition + an optional one-line finding captured when
 * the therapist marks an item ADDRESSED or CLOSED.
 */
export const UpdateAssessmentItemInputSchema = z.object({
  status: AssessmentItemStatusSchema,
  resolutionNote: z.string().max(1000).optional(),
  /// The session in which the item was addressed/closed, if applicable.
  addressedSessionId: CuidSchema.optional(),
});
export type UpdateAssessmentItemInput = z.infer<typeof UpdateAssessmentItemInputSchema>;

export const ListAssessmentItemsResponseSchema = z.object({
  items: z.array(AssessmentItemSchema),
});
export type ListAssessmentItemsResponse = z.infer<typeof ListAssessmentItemsResponseSchema>;
