import { z } from 'zod';
import { MedicalEncounterNoteV1Schema, RxPadV1Schema } from '@cureocity/contracts';

/** The signed record and original draft are separate clinical artefacts. */
export const ScribeEncounterReviewSchema = z.object({
  draft: z
    .object({
      status: z.string(),
      content: MedicalEncounterNoteV1Schema.nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
  signedNote: z
    .object({
      content: MedicalEncounterNoteV1Schema,
      rxPad: RxPadV1Schema.nullable(),
      signedAt: z.string().datetime(),
    })
    .nullable(),
});
export type ScribeEncounterReview = z.infer<typeof ScribeEncounterReviewSchema>;

export async function loadScribeEncounterReview(sessionId: string): Promise<ScribeEncounterReview> {
  const response = await fetch(`/api/v1/scribe/encounters/${sessionId}/review`, {
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error('Could not verify the saved encounter. Reload before reviewing or signing.');
  return ScribeEncounterReviewSchema.parse(await response.json());
}
