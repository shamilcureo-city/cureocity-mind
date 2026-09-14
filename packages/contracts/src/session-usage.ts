import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

export const SESSION_USAGE_DOMAIN = 'CUREOCITY_LIVE_USAGE_V1' as const;
const UsageId = z.string().min(1).max(128);
const ConnectionId = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const UsageCount = z.number().int().nonnegative().max(2_147_483_647);
// PostgreSQL timestamps have millisecond precision here. Normalize before
// canonical hashing so offset/no-fraction/submillisecond forms cannot produce
// a receipt that becomes unreadable after database timestamp round-tripping.
const UsageTimestamp = IsoDateTimeSchema.transform((value) => new Date(value).toISOString());
const ProvenanceIdentifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:/@+-]+$/);
/** Canonical decimal INR; four places, no float rounding or scientific notation. */
export const SessionUsageMoneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{4}$/);
export const SessionUsageStateSchema = z.enum(['OPEN', 'FINAL_REPORTED', 'INCOMPLETE']);
export const SessionUsageCoverageReasonSchema = z.enum([
  'UNREPORTED_PROVIDER_ATTEMPTS',
  'MISSING_CALL_USAGE',
  'UNPRICED_USAGE',
  'PROVENANCE_TRUNCATED',
  'UNTRACKED_STREAMING',
  'INTERRUPTED',
  'FINALIZATION_TIMEOUT',
  'PROCESS_SHUTDOWN',
]);
export const SessionUsageTotalsSchema = z
  .object({
    inputTokens: UsageCount,
    outputTokens: UsageCount,
    pass1Calls: UsageCount,
    pass2Calls: UsageCount,
    reasoningCalls: UsageCount,
    unknownCalls: UsageCount,
    costInr: SessionUsageMoneySchema,
    transcriptionInr: SessionUsageMoneySchema,
    notesInr: SessionUsageMoneySchema,
    reasoningInr: SessionUsageMoneySchema,
  })
  .strict();
export const SessionUsageProvenanceSchema = z
  .object({
    models: z.array(ProvenanceIdentifier).max(16),
    regions: z.array(ProvenanceIdentifier).max(16),
    promptVersions: z.array(ProvenanceIdentifier).max(32),
    pricingVersion: ProvenanceIdentifier.nullable(),
    configurationVersion: ProvenanceIdentifier.nullable(),
  })
  .strict();

const identity = {
  version: z.literal(1),
  domain: z.literal(SESSION_USAGE_DOMAIN),
  connectionId: ConnectionId,
  sessionId: UsageId,
  psychologistId: UsageId,
  vertical: z.enum(['THERAPIST', 'DOCTOR']),
};
export const SessionUsageRegistrationSchema = z
  .object({
    ...identity,
    type: z.literal('REGISTER'),
    startedAt: UsageTimestamp,
    backend: z.enum(['vertex', 'mock']),
  })
  .strict();
export type SessionUsageRegistration = z.infer<typeof SessionUsageRegistrationSchema>;
export const SessionUsageRegisterSchema = SessionUsageRegistrationSchema;
export type SessionUsageRegister = SessionUsageRegistration;

const ReceiptObjectSchema = z
  .object({
    ...identity,
    type: z.literal('RECEIPT'),
    sequence: UsageCount.min(1),
    state: SessionUsageStateSchema,
    endedAt: UsageTimestamp.nullable(),
    totals: SessionUsageTotalsSchema,
    usageBasis: z.enum(['LOCAL_ESTIMATE', 'MOCK_ZERO']),
    coverageReasons: z.array(SessionUsageCoverageReasonSchema).max(8),
    provenance: SessionUsageProvenanceSchema,
  })
  .strict();
type ReceiptBody = z.infer<typeof ReceiptObjectSchema>;
const moneyUnits = (value: string) => BigInt(value.replace('.', ''));
function validateReceipt(receipt: ReceiptBody, ctx: z.RefinementCtx) {
  const totals = receipt.totals;
  // A malformed decimal is already rejected by its scalar schema. Refinements
  // still run for dirty parses, so do not attempt BigInt on invalid input.
  if (
    [totals.costInr, totals.transcriptionInr, totals.notesInr, totals.reasoningInr].every(
      (value) => SessionUsageMoneySchema.safeParse(value).success,
    )
  ) {
    if (
      moneyUnits(totals.costInr) !==
      moneyUnits(totals.transcriptionInr) +
        moneyUnits(totals.notesInr) +
        moneyUnits(totals.reasoningInr)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totals'],
        message: 'Category estimates must sum exactly to the subtotal.',
      });
    }
    if (receipt.usageBasis === 'MOCK_ZERO' && moneyUnits(totals.costInr) !== 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totals', 'costInr'],
        message: 'Mock usage has no provider cost.',
      });
    }
  }
  if ((receipt.state === 'OPEN') !== (receipt.endedAt === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endedAt'],
      message: 'Only terminal receipts have an end time.',
    });
  }
  if (totals.unknownCalls > 0 && !receipt.coverageReasons.includes('MISSING_CALL_USAGE')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverageReasons'],
      message: 'Unknown call usage must remain explicit.',
    });
  }
  if (new Set(receipt.coverageReasons).size !== receipt.coverageReasons.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['coverageReasons'],
      message: 'Coverage reasons must be unique.',
    });
  }
}
export const SessionUsageReceiptSchema = ReceiptObjectSchema.superRefine(validateReceipt);
export type SessionUsageReceipt = z.infer<typeof SessionUsageReceiptSchema>;
export const SessionUsageCommandSchema = z
  .discriminatedUnion('type', [SessionUsageRegistrationSchema, ReceiptObjectSchema])
  .superRefine((command, ctx) => {
    if (command.type === 'RECEIPT') validateReceipt(command, ctx);
  });
export type SessionUsageCommand = z.infer<typeof SessionUsageCommandSchema>;

export const SessionUsageAckSchema = z
  .object({
    version: z.literal(1),
    domain: z.literal(SESSION_USAGE_DOMAIN),
    connectionId: ConnectionId,
    sessionId: UsageId,
    acceptedSequence: UsageCount,
    latestSequence: UsageCount,
    status: z.enum(['REGISTERED', 'ACCEPTED', 'DUPLICATE', 'STALE']),
    payloadHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export type SessionUsageAck = z.infer<typeof SessionUsageAckSchema>;

/** Shared bytes for a domain-bound receipt hash; arrays retain their declared order. */
export function canonicalSessionUsagePayload(input: SessionUsageCommand): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return value;
  };
  return JSON.stringify(canonical(input));
}

/** Sanitized disclosure: no service credentials, receipt hashes or retry identifiers. */
export const SessionUsageConnectionExportSchema = z
  .object({
    sessionId: UsageId,
    startedAt: IsoDateTimeSchema,
    registeredAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    endedAt: IsoDateTimeSchema.nullable(),
    backend: z.enum(['vertex', 'mock']),
    state: SessionUsageStateSchema,
    totals: SessionUsageTotalsSchema.nullable(),
    usageBasis: z.enum(['LOCAL_ESTIMATE', 'MOCK_ZERO']).nullable(),
    coverageReasons: z.array(SessionUsageCoverageReasonSchema).max(8),
    provenance: SessionUsageProvenanceSchema.nullable(),
  })
  .strict();
export type SessionUsageConnectionExport = z.infer<typeof SessionUsageConnectionExportSchema>;
