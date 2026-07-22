import { z } from 'zod';
import { AuditActionSchema } from './audit';
import { PsychologistRoleSchema, PsychologistStatusSchema } from './psychologist';

/**
 * PC2 — super-admin console DTOs. Inputs for the account-lifecycle and
 * Care-waitlist mutations, plus the audit-log query. Every route validates
 * against these before touching the DB.
 */

/// POST /api/v1/admin/accounts/[id]/role
export const AdminSetRoleInputSchema = z.object({
  role: PsychologistRoleSchema,
});
export type AdminSetRoleInput = z.infer<typeof AdminSetRoleInputSchema>;

/// POST /api/v1/admin/accounts/[id]/status
export const AdminSetStatusInputSchema = z.object({
  status: PsychologistStatusSchema,
  /// Short operator note kept in the audit metadata.
  reason: z.string().max(500).optional(),
});
export type AdminSetStatusInput = z.infer<typeof AdminSetStatusInputSchema>;

/// PATCH /api/v1/admin/accounts/[id]/trial-cap
export const AdminSetTrialCapInputSchema = z.object({
  cap: z.number().int().min(0).max(1000),
});
export type AdminSetTrialCapInput = z.infer<typeof AdminSetTrialCapInputSchema>;

/// POST /api/v1/admin/care-waitlist/[id]/invite
export const AdminWaitlistInviteInputSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type AdminWaitlistInviteInput = z.infer<typeof AdminWaitlistInviteInputSchema>;

/// GET /api/v1/admin/audit — query params (all optional; strings from the URL).
export const AdminAuditQuerySchema = z.object({
  action: AuditActionSchema.optional(),
  actorPsychologistId: z.string().min(1).optional(),
  targetType: z.string().min(1).max(80).optional(),
  targetId: z.string().min(1).optional(),
  /// ISO date lower bound (inclusive).
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;
