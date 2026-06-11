import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 37 — pilot invite codes.
 *
 * When PILOT_INVITE_REQUIRED=true, a new therapist's first sign-in
 * requires a valid code. Admins mint codes (single- or multi-use) and
 * can revoke them. Codes are uppercase alphanumeric, ambiguity-free
 * (no 0/O/1/I) so they're easy to read out over a call.
 */

export const InviteCodeStringSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9-]+$/, 'letters, digits and dashes only'));

export const CreateInviteCodeInputSchema = z.object({
  /** Admin note — who/what this code is for. */
  label: z.string().trim().min(1).max(120).optional(),
  /** How many signups this code may seat. Default 1. */
  maxUses: z.number().int().min(1).max(500).optional(),
  /** Optional expiry. */
  expiresAt: IsoDateTimeSchema.optional(),
});
export type CreateInviteCodeInput = z.infer<typeof CreateInviteCodeInputSchema>;

export const InviteCodeSchema = z.object({
  id: CuidSchema,
  code: z.string(),
  label: z.string().nullable(),
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  createdByPsychologistId: CuidSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Derived: usable right now (not revoked, not expired, uses remaining). */
  active: z.boolean(),
});
export type InviteCode = z.infer<typeof InviteCodeSchema>;

export const ListInviteCodesResponseSchema = z.object({
  items: z.array(InviteCodeSchema),
});
export type ListInviteCodesResponse = z.infer<typeof ListInviteCodesResponseSchema>;
