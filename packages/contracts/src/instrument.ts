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

/// Sprint 47 — who completed the administration. CLINICIAN is the
/// in-session default; SELF is a remote portal check-in the client
/// filled out themselves between sessions.
export const InstrumentAdministrationModeSchema = z.enum(['CLINICIAN', 'SELF']);
export type InstrumentAdministrationMode = z.infer<typeof InstrumentAdministrationModeSchema>;

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
  /// Sprint 47 — CLINICIAN (in-session) vs SELF (remote portal check-in).
  administrationMode: InstrumentAdministrationModeSchema.default('CLINICIAN'),
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

// ============================================================================
// Sprint 20 — Reliable-change verdict (measurement-based care).
//
// Computed deterministically in @cureocity/clinical/change-score from a
// baseline + latest administration. Surfaced on the client Journey hub so
// the therapist sees whether the client is actually improving, not just a
// list of raw scores.
// ============================================================================

export const ChangeVerdictSchema = z.enum([
  'reliable_improvement',
  'no_reliable_change',
  'deterioration',
]);
export type ChangeVerdict = z.infer<typeof ChangeVerdictSchema>;

export const InstrumentChangeSchema = z.object({
  instrumentKey: InstrumentKeySchema,
  baselineScore: z.number().int().nonnegative(),
  latestScore: z.number().int().nonnegative(),
  /** latest - baseline; negative = improvement (lower is better). */
  delta: z.number().int(),
  /** Percent change vs baseline; null when baseline is 0. */
  percentChange: z.number().nullable(),
  verdict: ChangeVerdictSchema,
  isResponse: z.boolean(),
  isRemission: z.boolean(),
  baselineSeverityKey: z.string(),
  latestSeverityKey: z.string(),
  /** Number of administrations the verdict is based on (≥2 to be meaningful). */
  administrationCount: z.number().int().positive(),
  baselineAt: IsoDateTimeSchema,
  latestAt: IsoDateTimeSchema,
});
export type InstrumentChange = z.infer<typeof InstrumentChangeSchema>;
