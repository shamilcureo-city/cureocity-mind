import { z } from 'zod';

/**
 * Letters — Sprint 66.
 *
 * Therapist-authored letters generated from case data: a referral to a
 * psychiatrist/GP (the MHCA medication-referral need), or a supporting
 * letter (attendance, fitness-to-work/study, general support). The body is
 * composed deterministically from a template + the client's record, then
 * rendered to a credential-stamped PDF.
 */

export const LetterKindSchema = z.enum(['REFERRAL', 'ATTENDANCE', 'FITNESS', 'SUPPORT']);
export type LetterKind = z.infer<typeof LetterKindSchema>;

export const CreateLetterInputSchema = z.object({
  kind: LetterKindSchema,
  /** Addressee, e.g. "Dr. A. Sharma" or "To whom it may concern". */
  recipient: z.string().trim().min(1).max(160),
  /** Optional extra context the therapist wants woven into the body. */
  note: z.string().trim().max(2000).optional(),
});
export type CreateLetterInput = z.infer<typeof CreateLetterInputSchema>;

export const LetterSchema = z.object({
  id: z.string(),
  kind: LetterKindSchema,
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Letter = z.infer<typeof LetterSchema>;

export const LETTER_KIND_LABELS: Record<LetterKind, string> = {
  REFERRAL: 'Referral to a doctor',
  ATTENDANCE: 'Proof of attendance',
  FITNESS: 'Fitness / accommodation',
  SUPPORT: 'General supporting letter',
};
