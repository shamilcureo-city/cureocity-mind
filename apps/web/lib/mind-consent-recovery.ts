import { z } from 'zod';

/** Shared UI-safe contract. Recovery confirms permission from now, not in the past. */
export const MIND_CONSENT_RECOVERY_SCRIPT_VERSION = 'v1.1' as const;
export const MIND_CONSENT_RECOVERY_SCOPES = [
  'AUDIO_RECORDING',
  'AI_NOTE_GENERATION',
  'CROSS_BORDER_PROCESSING',
] as const;

export const MindConsentRecoveryInputSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    confirmations: z
      .object({
        AUDIO_RECORDING: z.literal(true),
        AI_NOTE_GENERATION: z.literal(true),
        CROSS_BORDER_PROCESSING: z.literal(true),
      })
      .strict(),
  })
  .strict();

const MindConsentRecoveryStateFieldsSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS']),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  scriptVersion: z.literal(MIND_CONSENT_RECOVERY_SCRIPT_VERSION),
  scopes: z
    .array(
      z.object({
        scope: z.enum(MIND_CONSENT_RECOVERY_SCOPES),
        sessionAcknowledged: z.boolean(),
        standingStatus: z.enum(['GRANTED', 'WITHDRAWN', 'EXPIRED', 'MISSING']),
      }),
    )
    .length(3)
    .refine((scopes) => new Set(scopes.map((scope) => scope.scope)).size === 3, {
      message: 'Every required scope must be present exactly once',
    }),
  ready: z.boolean(),
});

const isConsistentReady = (state: z.infer<typeof MindConsentRecoveryStateFieldsSchema>) =>
  state.ready ===
  state.scopes.every((scope) => scope.sessionAcknowledged && scope.standingStatus === 'GRANTED');

export const MindConsentRecoveryStateSchema = MindConsentRecoveryStateFieldsSchema.refine(
  isConsistentReady,
  { message: 'Readiness must match all current required consents' },
);

export const MindConsentRecoveryReceiptSchema = MindConsentRecoveryStateFieldsSchema.extend({
  operationId: z.string().uuid(),
  replayed: z.boolean(),
}).refine((state) => state.ready && isConsistentReady(state), {
  message: 'A recovery receipt must confirm every current required consent',
});

export type MindConsentRecoveryInput = z.infer<typeof MindConsentRecoveryInputSchema>;
export type MindConsentRecoveryState = z.infer<typeof MindConsentRecoveryStateSchema>;
export type MindConsentRecoveryReceipt = z.infer<typeof MindConsentRecoveryReceiptSchema>;
