import { z } from 'zod';
import { IsoDateSchema } from './common';

const CareText = z.string().trim().max(2000);
const CareDate = IsoDateSchema.nullable();

/** Explicit clinician-authored delivery, never derived from reading/selecting a guide. */
export const MindSessionWorkSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    scheduledAt: z.string().datetime(),
    disposition: z.enum(['USED', 'ADAPTED', 'PAUSED', 'NOT_USED']),
    workDone: CareText.min(1),
    clientResponse: CareText.default(''),
  })
  .strict();
export type MindSessionWork = z.infer<typeof MindSessionWorkSchema>;

/** Clinician-authored context only. Not recording consent, a score, diagnosis or discharge. */
export const MindCareRecordBodySchema = z
  .object({
    version: z.literal('V1'),
    // Optional preserves decoding of every earlier encrypted V1 record. Omission in a legacy
    // write preserves the current section; it is not an instruction to erase confirmed work.
    sessionWork: MindSessionWorkSchema.optional(),
    agreement: z
      .object({
        scope: CareText,
        confidentialityAndLimits: CareText,
        practicalArrangements: CareText,
        contactAndCrisisArrangements: CareText,
        clientPriorities: CareText,
        discussedOn: CareDate,
        reviewOn: CareDate,
      })
      .strict(),
    clientVoice: z
      .object({
        recordedOn: CareDate,
        whatHelped: CareText,
        whatCouldChange: CareText,
        everydayChanges: CareText,
        clinicianReflection: CareText,
      })
      .strict(),
    continuity: z
      .object({
        stage: z.enum(['NOT_PLANNED', 'DISCUSSING', 'AGREED']),
        maintenancePlan: CareText,
        warningSignsAndResponse: CareText,
        endingOrReferralPlan: CareText,
        referralFollowThrough: CareText,
        reviewOn: CareDate,
      })
      .strict(),
  })
  .strict();
export type MindCareRecordBody = z.infer<typeof MindCareRecordBodySchema>;

export const SaveMindCareRecordInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    operationId: z.string().uuid(),
    body: MindCareRecordBodySchema,
  })
  .strict();
export const MindCareRecordQuerySchema = z
  .object({ version: z.coerce.number().int().positive().optional() })
  .strict();
export const MindCareRecordDtoSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  version: z.number().int().positive(),
  operationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  body: MindCareRecordBodySchema,
});
export type MindCareRecordDto = z.infer<typeof MindCareRecordDtoSchema>;
export const MindCareRecordResponseSchema = z.object({
  record: MindCareRecordDtoSchema.nullable(),
  latestVersion: z.number().int().min(0),
});
