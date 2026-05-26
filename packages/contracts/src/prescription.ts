import { z } from 'zod';
import { CuidSchema } from './common';
import { RiskSeveritySchema } from './note';

export const PrescriptionRecommendationSchema = z.object({
  exerciseId: z.string(),
  title: z.string(),
  score: z.number(),
  rationale: z.array(z.string()),
});
export type PrescriptionRecommendation = z.infer<typeof PrescriptionRecommendationSchema>;

export const PrescriptionRequestSchema = z.object({
  /**
   * Optional: client supplies the latest risk severity (read from the most
   * recent NoteDraft). When omitted, the service falls back to 'none'.
   */
  recentRiskSeverity: RiskSeveritySchema.default('none'),
  maxRecommendations: z.number().int().positive().max(20).default(5),
});
export type PrescriptionRequest = z.infer<typeof PrescriptionRequestSchema>;

export const PrescriptionResponseSchema = z.object({
  workflowId: CuidSchema,
  currentPhase: z.string(),
  recommendations: z.array(PrescriptionRecommendationSchema),
  signalsUsed: z.object({
    recentRiskSeverity: RiskSeveritySchema,
    adherenceEntries: z.number().int().nonnegative(),
  }),
});
export type PrescriptionResponse = z.infer<typeof PrescriptionResponseSchema>;
