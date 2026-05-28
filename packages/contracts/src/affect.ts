import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

export const AffectSessionPointSchema = z.object({
  sessionId: CuidSchema,
  endedAt: IsoDateTimeSchema,
  meanValence: z.number().min(-1).max(1),
  meanArousal: z.number().min(0).max(1),
  /** Sample count = number of affect features used to compute the means. */
  sampleCount: z.number().int().nonnegative(),
});
export type AffectSessionPoint = z.infer<typeof AffectSessionPointSchema>;

export const AffectBaselineStatusSchema = z.enum(['INSUFFICIENT_DATA', 'ESTABLISHED']);
export type AffectBaselineStatus = z.infer<typeof AffectBaselineStatusSchema>;

export const AffectBaselineSchema = z.object({
  clientId: CuidSchema,
  status: AffectBaselineStatusSchema,
  /**
   * Number of completed sessions with affect features included in the
   * baseline computation. Null when status=INSUFFICIENT_DATA.
   */
  sessionsUsed: z.number().int().nonnegative(),
  windowSessions: z.number().int().positive(),
  minSessions: z.number().int().positive(),
  /** Aggregate valence stats. Null when status=INSUFFICIENT_DATA. */
  valence: z
    .object({
      mean: z.number().min(-1).max(1),
      stddev: z.number().nonnegative(),
    })
    .nullable(),
  arousal: z
    .object({
      mean: z.number().min(0).max(1),
      stddev: z.number().nonnegative(),
    })
    .nullable(),
  computedAt: IsoDateTimeSchema,
});
export type AffectBaseline = z.infer<typeof AffectBaselineSchema>;

export const AffectDeviationSchema = z.object({
  sessionId: CuidSchema,
  endedAt: IsoDateTimeSchema,
  dimension: z.enum(['valence', 'arousal']),
  /** How many standard deviations from the baseline mean. Signed. */
  sigma: z.number(),
  /** Neutral-language flag — no clinical interpretation. */
  message: z.string(),
});
export type AffectDeviation = z.infer<typeof AffectDeviationSchema>;

export const AffectTrendSchema = z.object({
  clientId: CuidSchema,
  baseline: AffectBaselineSchema,
  points: z.array(AffectSessionPointSchema),
  deviations: z.array(AffectDeviationSchema),
  sigmaThreshold: z.number(),
});
export type AffectTrend = z.infer<typeof AffectTrendSchema>;
