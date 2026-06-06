import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema } from './clinical';

/**
 * Sprint 17 — Safety Plan (Stanley & Brown 5-step).
 *
 * Created when the therapist confirms a crisis section at high or
 * critical severity in the Clinical Brief. The 5 fields below match
 * the canonical Stanley & Brown framework; populated by the
 * therapist with the client either in-session or as homework.
 *
 * One row per (client, generation); the most recent supersedes
 * earlier ones (older rows are kept with supersededAt for audit).
 */

export const SafetyPlanV1Schema = z.object({
  version: z.literal('V1'),
  language: ClinicalLocaleSchema.default('en'),
  /** 1. Warning signs (thoughts / situations / moods) that a crisis is coming. */
  warningSigns: z.array(z.string().min(1).max(400)).min(1).max(8),
  /** 2. Internal coping strategies the client can do alone. */
  internalCoping: z.array(z.string().min(1).max(400)).min(1).max(8),
  /** 3. Social contacts / settings that distract from the crisis. */
  socialDistractions: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        contact: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(8),
  /** 4. People to call/visit for help during a crisis. */
  helpContacts: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        relationship: z.string().max(100).optional(),
        contact: z.string().max(200),
      }),
    )
    .min(1)
    .max(8),
  /** 5. Professionals / agencies + crisis hotlines. */
  professionals: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        contact: z.string().max(200),
        availability: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(8),
  /** Means-restriction step (optional in V1; recommended for suicidal-plan presentations). */
  meansRestriction: z.string().max(800).optional(),
});
export type SafetyPlanV1 = z.infer<typeof SafetyPlanV1Schema>;

// ============================================================================
// Row DTO
// ============================================================================

export const SafetyPlanRowSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  sourceSessionId: CuidSchema.nullable(),
  language: ClinicalLocaleSchema,
  body: SafetyPlanV1Schema,
  confirmedAt: IsoDateTimeSchema,
  confirmedByPsychologistId: CuidSchema,
  supersededAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SafetyPlanRow = z.infer<typeof SafetyPlanRowSchema>;

// ============================================================================
// POST /api/v1/clients/[id]/safety-plan
// ============================================================================

export const SaveSafetyPlanInputSchema = z.object({
  sourceSessionId: CuidSchema.optional(),
  body: SafetyPlanV1Schema,
});
export type SaveSafetyPlanInput = z.infer<typeof SaveSafetyPlanInputSchema>;
