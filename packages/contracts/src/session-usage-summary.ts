import { z } from 'zod';

const money = z.string().regex(/^\d+\.\d{4}$/);
export const SessionUsageSummarySchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    recordedSubtotalInr: money.nullable(),
    liveConnectionSubtotalInr: money.nullable(),
    webCallSubtotalInr: money.nullable(),
    legacySubtotalInr: money.nullable(),
    lowerBound: z.boolean(),
    coverage: z.enum(['PARTIAL', 'NO_RECORDED_USAGE']),
    coverageReasons: z.array(z.string().min(1).max(120)).max(32),
    connections: z
      .object({
        registered: z.number().int().nonnegative(),
        receipted: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        finalReported: z.number().int().nonnegative(),
        incomplete: z.number().int().nonnegative(),
      })
      .strict(),
    webCallRecords: z.number().int().nonnegative(),
    legacyOverlap: z.enum(['NONE', 'UNPROVEN']),
    usageBasis: z.literal('RECORDED_ESTIMATE'),
    reconciliation: z.literal('NOT_RECONCILED'),
  })
  .strict();

export type SessionUsageSummary = z.infer<typeof SessionUsageSummarySchema>;
