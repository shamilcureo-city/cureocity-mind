import { z } from 'zod';

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
