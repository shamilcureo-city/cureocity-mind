import { z } from 'zod';

/**
 * Problem list — Sprint 67c.
 *
 * A maintained, editable per-client problem list: a stable clinical
 * artefact the therapist owns, distinct from the auto-synthesised Case
 * Briefing. Items can be active or resolved.
 */

export const ProblemStatusSchema = z.enum(['ACTIVE', 'RESOLVED']);
export type ProblemStatus = z.infer<typeof ProblemStatusSchema>;

export const CreateProblemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).optional(),
});
export type CreateProblemInput = z.infer<typeof CreateProblemInputSchema>;

export const UpdateProblemInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    detail: z.string().trim().max(2000).nullable().optional(),
    status: ProblemStatusSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.detail !== undefined || v.status !== undefined, {
    message: 'Provide at least one field to update.',
  });
export type UpdateProblemInput = z.infer<typeof UpdateProblemInputSchema>;

export const ProblemListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  status: ProblemStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type ProblemListItem = z.infer<typeof ProblemListItemSchema>;
