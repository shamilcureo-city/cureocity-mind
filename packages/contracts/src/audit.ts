import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema, PaginationCursorSchema } from './common';

export const AuditActionSchema = z.enum([
  'PSYCHOLOGIST_REGISTERED',
  'PSYCHOLOGIST_UPDATED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_VIEWED',
  'CLIENT_BRIEFING_VIEWED',
  'CLIENT_SOFT_DELETED',
  'CONSENT_GRANTED',
  'CONSENT_WITHDRAWN',
  'CONSENT_EXPIRED',
  'SESSION_CREATED',
  'SESSION_CONSENT_RECORDED',
  'SESSION_STARTED',
  'SESSION_ENDED',
  'SESSION_CANCELLED',
  'AUDIO_CHUNK_UPLOADED',
  'NOTE_DRAFT_CREATED',
  'NOTE_DRAFT_VIEWED',
  'NOTE_SIGNED',
  'COST_CIRCUIT_TRIPPED',
  'CRISIS_FLAG_RAISED',
  'WORKFLOW_CREATED',
  'WORKFLOW_PHASE_TRANSITIONED',
  'WORKFLOW_COMPLETED',
  'EXERCISE_PRESCRIBED',
  'EMDR_PREPARATION_COMPLETED',
  'EMDR_TARGET_ADDED',
  'EMDR_TARGET_UPDATED',
  'AFFECT_BASELINE_VIEWED',
  'AFFECT_TREND_VIEWED',
  'EXERCISE_ASSIGNED',
  'EXERCISE_COMPLETION_RECORDED',
  'EXERCISE_SKIPPED',
  'MOOD_LOGGED',
  'JOURNAL_ENTRY_CREATED',
  'JOURNAL_ENTRY_UPDATED',
  'CLIENT_FIREBASE_LINKED',
  'AUDIO_RETENTION_PURGED',
  'CLIENT_CLAIM_TOKEN_ISSUED',
  'CLIENT_CLAIM_TOKEN_REDEEMED',
  'PUSH_SUBSCRIPTION_REGISTERED',
  'PUSH_SUBSCRIPTION_REVOKED',
  'NOTIFICATION_DISPATCHED',
  'TREATMENT_PLAN_WHATSAPP_SENT',
  'ADMIN_AUDIT_LOG_READ',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_ROLE_REVOKED',
  'DSR_ACCESS_REQUESTED',
  'DSR_ACCESS_FULFILLED',
  'DSR_CORRECTION_REQUESTED',
  'DSR_ERASURE_REQUESTED',
  'DSR_ERASURE_FULFILLED',
  'DSR_NOMINATION_RECORDED',
  'DSR_GRIEVANCE_FILED',
  'DSR_CONSENT_WITHDRAWN',
]);

export const AuditActorTypeSchema = z.enum(['PSYCHOLOGIST', 'SYSTEM', 'CLIENT']);

export const AuditMetadataSchema = z
  .object({
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    requestId: z.string().optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .passthrough();

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;
export type AuditMetadata = z.infer<typeof AuditMetadataSchema>;

// ============================================================================
// Admin audit-log read — Sprint 9 PR 1.
//
// Returns a slice of the AuditLog table with composable filters. Every
// call writes its own ADMIN_AUDIT_LOG_READ row (audit-of-the-audit) so
// the activity of admins reviewing the log is itself reviewable.
// ============================================================================

export const AuditLogQuerySchema = z.object({
  /** ISO datetime — inclusive lower bound on createdAt. */
  from: IsoDateTimeSchema.optional(),
  /** ISO datetime — exclusive upper bound on createdAt. */
  to: IsoDateTimeSchema.optional(),
  action: AuditActionSchema.optional(),
  actorPsychologistId: CuidSchema.optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: CuidSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  cursor: PaginationCursorSchema,
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogEntrySchema = z.object({
  id: CuidSchema,
  actorType: AuditActorTypeSchema,
  actorPsychologistId: CuidSchema.nullable(),
  action: AuditActionSchema,
  targetType: z.string(),
  targetId: z.string(),
  metadata: AuditMetadataSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogPageSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  nextCursor: CuidSchema.nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;
