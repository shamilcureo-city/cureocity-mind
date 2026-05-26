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
  'SESSION_STARTED',
  'SESSION_ENDED',
  'SESSION_CANCELLED',
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
