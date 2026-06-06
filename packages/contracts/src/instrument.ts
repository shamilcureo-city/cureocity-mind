import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema } from './clinical';

/**
 * Sprint 17 — Scored clinical instruments (PHQ-9, GAD-7, ...).
 *
 * The instrument definitions themselves live in
 * `@cureocity/clinical/instruments` — that's where item banks,
 * scoring functions, and severity bands are curated. This file
 * defines only the over-the-wire shapes for administering an
 * instrument and surfacing its result.
 *
 * Why curated vs LLM-generated: a scored instrument's validity
 * depends on EXACT wording + EXACT scoring. PHQ-9 with slightly
 * paraphrased items is no longer PHQ-9. Translations require
 * clinician sign-off and existing validated versions; do not
 * machine-translate.
 */

export const InstrumentKeySchema = z.enum(['PHQ9', 'GAD7']);
export type InstrumentKey = z.infer<typeof InstrumentKeySchema>;

/** PHQ-9 + GAD-7 use 0..3 per item. */
export const InstrumentResponseValueSchema = z.number().int().min(0).max(3);
export type InstrumentResponseValue = z.infer<typeof InstrumentResponseValueSchema>;

/** itemId → integer answer. */
export const InstrumentResponseMapSchema = z.record(z.string(), InstrumentResponseValueSchema);
export type InstrumentResponseMap = z.infer<typeof InstrumentResponseMapSchema>;

// ============================================================================
// Server-side row DTO
// ============================================================================

export const InstrumentResponseSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  sessionId: CuidSchema.nullable(),
  instrumentKey: InstrumentKeySchema,
  language: ClinicalLocaleSchema,
  responses: InstrumentResponseMapSchema,
  score: z.number().int().nonnegative(),
  severity: z.string(),
  administeredAt: IsoDateTimeSchema,
  administeredByPsychologistId: CuidSchema,
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type InstrumentResponse = z.infer<typeof InstrumentResponseSchema>;

// ============================================================================
// POST /api/v1/clients/[id]/instruments — administer + score
// ============================================================================

export const AdministerInstrumentInputSchema = z.object({
  instrumentKey: InstrumentKeySchema,
  language: ClinicalLocaleSchema.optional(),
  responses: InstrumentResponseMapSchema,
  sessionId: CuidSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type AdministerInstrumentInput = z.infer<typeof AdministerInstrumentInputSchema>;

export const ListInstrumentResponsesQuerySchema = z.object({
  instrumentKey: InstrumentKeySchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListInstrumentResponsesQuery = z.infer<typeof ListInstrumentResponsesQuerySchema>;

export const ListInstrumentResponsesResponseSchema = z.object({
  items: z.array(InstrumentResponseSchema),
});
export type ListInstrumentResponsesResponse = z.infer<typeof ListInstrumentResponsesResponseSchema>;
