import { z } from 'zod';

/**
 * Supervision review — Sprint 68.
 *
 * A record that a signed note was reviewed in supervision: the reviewer's
 * name, optional feedback, and the date. Captures the supervision /
 * medico-legal artefact (relevant to India's supervised-hours reality)
 * without a full multi-account supervisor-relationship system, which is a
 * larger, security-sensitive follow-up.
 */

export const CreateNoteReviewInputSchema = z.object({
  reviewerName: z.string().trim().min(1).max(160),
  reviewerNote: z.string().trim().max(2000).optional(),
  /** ISO date the review took place; defaults to now server-side. */
  reviewedAt: z.string().datetime().optional(),
});
export type CreateNoteReviewInput = z.infer<typeof CreateNoteReviewInputSchema>;

export const NoteReviewSchema = z.object({
  id: z.string(),
  reviewerName: z.string(),
  reviewerNote: z.string().nullable(),
  reviewedAt: z.string(),
  createdAt: z.string(),
});
export type NoteReview = z.infer<typeof NoteReviewSchema>;
