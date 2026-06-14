import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema, Icd11CodeSchema } from './clinical';

/**
 * Sprint 52 — Case Consult (Pass 8).
 *
 * A structured second opinion the therapist generates when they are
 * stuck on a case. Distinct from the Case Briefing (Pass 6 / Sprint
 * 22), which answers "what's going on with this client?" — the
 * Consult answers "given everything I've tried and what the data
 * shows, what should I consider next?". Cached per (clientId,
 * lastSessionId) like the pre-session brief; regenerates when a new
 * session completes.
 *
 * Safety stance — the prompt prevents diagnosing or recommending
 * medication; outputs read as "options for the therapist to consider"
 * + "questions to bring to supervision". The Consult is NEVER
 * patient-shareable (no PatientShare artefact type).
 */

/**
 * One option the therapist could try next, with rationale. India-context
 * notes are optional but encouraged (family dynamics, stigma, access).
 */
export const CaseConsultOptionSchema = z.object({
  option: z.string().min(1).max(400),
  rationale: z.string().min(1).max(1200),
  indiaContextNote: z.string().max(800).nullable().default(null),
});
export type CaseConsultOption = z.infer<typeof CaseConsultOptionSchema>;

/**
 * One differential consideration with both supporting + contradicting
 * evidence. The Consult is brief-shaped (≤5 candidates) — the
 * therapist already has the clinical brief for full differential
 * work.
 */
export const CaseConsultDifferentialSchema = z.object({
  consideration: z.string().min(1).max(400),
  icd11Code: Icd11CodeSchema.nullable().default(null),
  evidenceFor: z.string().min(1).max(1200),
  evidenceAgainst: z.string().min(1).max(1200),
});
export type CaseConsultDifferential = z.infer<typeof CaseConsultDifferentialSchema>;

/**
 * One "what has been tried" entry. `observedEffect` is a brief
 * outcome description so the next step can build on it.
 */
export const CaseConsultTriedSchema = z.object({
  approach: z.string().min(1).max(200),
  sessions: z.number().int().nonnegative(),
  observedEffect: z.string().min(1).max(600),
});
export type CaseConsultTried = z.infer<typeof CaseConsultTriedSchema>;

export const CaseConsultV1Schema = z.object({
  version: z.literal('V1'),
  language: ClinicalLocaleSchema.default('en'),
  /// 2-3 sentence summary of where the case is and what's stuck.
  situationSummary: z.string().min(1).max(2000),
  /// Things the therapist (per the chart) has tried and the observed
  /// effect. 0-6 entries; sessions count is best-effort.
  whatsBeenTried: z.array(CaseConsultTriedSchema).max(6).default([]),
  /// Deterministic inputs echoed back as bullets so the therapist
  /// sees the data the consult relied on.
  whatTheDataShows: z.array(z.string().min(1).max(600)).max(10).default([]),
  /// 0-5 differential considerations to weigh.
  differentialConsiderations: z
    .array(CaseConsultDifferentialSchema)
    .max(5)
    .default([]),
  /// 0-5 evidence-based options to consider next.
  evidenceBasedOptions: z.array(CaseConsultOptionSchema).max(5).default([]),
  /// 0-6 questions to bring to supervision / peer review.
  questionsForSupervision: z.array(z.string().min(1).max(400)).max(6).default([]),
  /// 0-5 India-context cautions (family, stigma, access, supervision norms).
  indiaContextCautions: z.array(z.string().min(1).max(600)).max(5).default([]),
  /// Liability + scope disclaimer surfaced under the result.
  disclaimer: z.string().min(1).max(800),
});
export type CaseConsultV1 = z.infer<typeof CaseConsultV1Schema>;

// ============================================================================
// Server-side row DTO. Mirrors PreSessionBrief shape; cached per
// (clientId, lastSessionId) and invalidated by the next completed session.
// ============================================================================

export const CaseConsultStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export type CaseConsultStatus = z.infer<typeof CaseConsultStatusSchema>;

export const CaseConsultSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  lastSessionId: CuidSchema.nullable(),
  status: CaseConsultStatusSchema,
  body: CaseConsultV1Schema.nullable(),
  totalCostInr: z.string(),
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CaseConsult = z.infer<typeof CaseConsultSchema>;
