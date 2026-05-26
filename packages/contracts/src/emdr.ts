import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

export const EmdrPhaseSchema = z.enum([
  'history_taking',
  'preparation',
  'assessment',
  'desensitization',
  'installation',
  'body_scan',
  'closure',
  'reevaluation',
]);
export type EmdrPhase = z.infer<typeof EmdrPhaseSchema>;

export const EmdrTargetStatusSchema = z.enum([
  'identified',
  'assessed',
  'in_desensitization',
  'desensitized',
  'installed',
  'body_scan_clear',
  'closed',
]);
export type EmdrTargetStatus = z.infer<typeof EmdrTargetStatusSchema>;

/**
 * One target memory inside an EMDR workflow. Tracks the four canonical
 * EMDR fields (SUDS / VOC / NC / PC) plus emotion + body sensation.
 *
 *   SUDS: Subjective Units of Distress, 0 (none) - 10 (worst)
 *   VOC:  Validity of Cognition, 1 (completely false) - 7 (completely true)
 *   NC:   Negative Cognition (irrational belief, e.g. "I am unsafe")
 *   PC:   Positive Cognition (replacement belief, e.g. "I am safe now")
 */
export const CreateEmdrTargetInputSchema = z.object({
  /** Short label so therapist + client can refer to it. */
  label: z.string().min(1).max(200),
  /** Image / memory description. */
  image: z.string().min(1).max(2000),
  negativeCognition: z.string().min(1).max(500),
  positiveCognition: z.string().min(1).max(500),
  /** 1..7 — initial validity rating of the positive cognition. */
  vocStart: z.number().int().min(1).max(7),
  /** 0..10 — initial subjective units of distress. */
  sudsStart: z.number().int().min(0).max(10),
  emotion: z.string().min(1).max(200),
  bodyLocation: z.string().min(1).max(200),
});
export type CreateEmdrTargetInput = z.infer<typeof CreateEmdrTargetInputSchema>;

export const UpdateEmdrTargetInputSchema = z
  .object({
    sudsCurrent: z.number().int().min(0).max(10),
    vocCurrent: z.number().int().min(1).max(7),
    status: EmdrTargetStatusSchema,
    bilateralSetsTotal: z.number().int().nonnegative(),
    /** Free-text notes appended to the target's history. */
    progressNote: z.string().max(2000),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });
export type UpdateEmdrTargetInput = z.infer<typeof UpdateEmdrTargetInputSchema>;

export const EmdrTargetSchema = z.object({
  id: CuidSchema,
  stateId: CuidSchema,
  label: z.string(),
  image: z.string(),
  negativeCognition: z.string(),
  positiveCognition: z.string(),
  vocStart: z.number(),
  vocCurrent: z.number().nullable(),
  sudsStart: z.number(),
  sudsCurrent: z.number().nullable(),
  emotion: z.string(),
  bodyLocation: z.string(),
  status: EmdrTargetStatusSchema,
  bilateralSetsTotal: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type EmdrTarget = z.infer<typeof EmdrTargetSchema>;

export const PreparationCompleteInputSchema = z.object({
  /** Therapist confirms safe-place installation + resource dev done. */
  safePlaceInstalled: z.literal(true),
  resourcesAdequate: z.literal(true),
  dissociationScreened: z.literal(true),
  notes: z.string().max(1000).optional(),
});
export type PreparationCompleteInput = z.infer<typeof PreparationCompleteInputSchema>;
