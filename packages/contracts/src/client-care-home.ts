import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { PatientShareSnapshotSchema } from './share';

export const CLIENT_CARE_HOME_ORDER = [
  'WHAT_TO_DO_NEXT',
  'UPCOMING_SESSION',
  'HOMEWORK_CHECKINS',
  'GOALS_PROGRESS',
  'THERAPIST_RESOURCES',
  'HISTORY',
] as const;

const CareHomeItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(300),
    detail: z.string().max(2000).nullable().default(null),
    occurredAt: IsoDateTimeSchema.nullable().default(null),
    href: z.string().startsWith('/p/').nullable().default(null),
    snapshot: PatientShareSnapshotSchema.nullable().default(null),
  })
  .strict();

const SectionSchema = z
  .object({
    kind: z.enum(CLIENT_CARE_HOME_ORDER),
    items: z.array(CareHomeItemSchema).max(100),
  })
  .strict();

export const ClientCareHomeSchema = z
  .object({
    clientId: CuidSchema,
    sections: z.array(SectionSchema).length(CLIENT_CARE_HOME_ORDER.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.sections.forEach((section, index) => {
      if (section.kind !== CLIENT_CARE_HOME_ORDER[index]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', index, 'kind'],
          message: 'invalid section order',
        });
      }
    });
  });
export type ClientCareHome = z.infer<typeof ClientCareHomeSchema>;
