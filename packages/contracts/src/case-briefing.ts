import { z } from 'zod';
import { Icd11CodeSchema } from './clinical';
import { IsoDateTimeSchema } from './common';
import { AssessmentItemKindSchema } from './assessment-item';

/**
 * Sprint 22 — Case Briefing (Pass 6).
 *
 * The single synthesis at the centre of the Case Workspace. Answers the
 * four questions a therapist actually has when a client is in front of
 * them: what's going on (5 Ps formulation), what's still open (the
 * running differential), the next 1-3 concrete actions (each with a
 * reason + timing), and when to see the client again.
 *
 * Always computable deterministically (apps/web/lib/case-briefing.ts);
 * Pass 6 layers an LLM narrative on top with the deterministic version
 * as the guaranteed fallback (`source` records which produced it).
 */

/** The 5 Ps case formulation — the bridge from assessment to treatment. */
export const FivePFormulationSchema = z.object({
  presenting: z.string().max(1200),
  predisposing: z.string().max(1200),
  precipitating: z.string().max(1200),
  perpetuating: z.string().max(1200),
  protective: z.string().max(1200),
});
export type FivePFormulation = z.infer<typeof FivePFormulationSchema>;

export const CaseBriefingWorkingDiagnosisSchema = z.object({
  icd11Code: Icd11CodeSchema,
  icd11Label: z.string(),
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
});

export const CaseBriefingOpenItemSchema = z.object({
  id: z.string(),
  kind: AssessmentItemKindSchema,
  question: z.string(),
  rationale: z.string(),
  icd11Code: z.string().nullable(),
});

export const CaseBriefingWhenSchema = z.enum([
  'this_session',
  'next_session',
  'this_week',
  'before_review',
]);
export type CaseBriefingWhen = z.infer<typeof CaseBriefingWhenSchema>;

export const CaseBriefingActionSchema = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(800),
  why: z.string().min(1).max(600),
  when: CaseBriefingWhenSchema,
  ctaLabel: z.string().min(1).max(60).nullable(),
  ctaHref: z.string().min(1).max(400).nullable(),
});
export type CaseBriefingAction = z.infer<typeof CaseBriefingActionSchema>;

export const CaseBriefingCadenceSchema = z.object({
  recommendedIntervalDays: z.number().int().positive(),
  rationale: z.string().min(1).max(400),
  reviewDueInSessions: z.number().int().nullable(),
});
export type CaseBriefingCadence = z.infer<typeof CaseBriefingCadenceSchema>;

export const CaseBriefingSafetySchema = z.object({
  highestSeverity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
  openCrisisFlags: z.array(z.string()),
  hasSafetyPlan: z.boolean(),
});

export const CaseBriefingV1Schema = z.object({
  version: z.literal('V1'),
  /// One-paragraph plain-clinical summary shown at the top.
  headline: z.string().min(1).max(800),
  formulation: FivePFormulationSchema,
  workingDiagnosis: CaseBriefingWorkingDiagnosisSchema.nullable(),
  openItems: z.array(CaseBriefingOpenItemSchema),
  nextActions: z.array(CaseBriefingActionSchema).min(0).max(3),
  cadence: CaseBriefingCadenceSchema,
  safety: CaseBriefingSafetySchema,
  generatedAt: IsoDateTimeSchema,
  source: z.enum(['llm', 'deterministic']),
});
export type CaseBriefingV1 = z.infer<typeof CaseBriefingV1Schema>;

export const CaseBriefingResponseSchema = z.object({
  briefing: CaseBriefingV1Schema,
});
export type CaseBriefingResponse = z.infer<typeof CaseBriefingResponseSchema>;
