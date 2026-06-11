import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 39 — multi-tenant clinics (Phase 1, additive foundation).
 *
 * Every therapist is an OWNER of their own auto-created SOLO clinic.
 * GROUP clinics + cross-therapist membership management land in Phase 2;
 * these contracts describe the read surface that exists today.
 */

export const ClinicKindSchema = z.enum(['SOLO', 'GROUP']);
export type ClinicKind = z.infer<typeof ClinicKindSchema>;

export const ClinicRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type ClinicRole = z.infer<typeof ClinicRoleSchema>;

export const ClinicMemberSchema = z.object({
  psychologistId: CuidSchema,
  fullName: z.string(),
  role: ClinicRoleSchema,
  joinedAt: IsoDateTimeSchema,
});
export type ClinicMember = z.infer<typeof ClinicMemberSchema>;

export const ClinicSchema = z.object({
  id: CuidSchema,
  name: z.string(),
  kind: ClinicKindSchema,
  /** The requesting therapist's role in this clinic. */
  myRole: ClinicRoleSchema,
  members: z.array(ClinicMemberSchema),
  createdAt: IsoDateTimeSchema,
});
export type Clinic = z.infer<typeof ClinicSchema>;

/** GET /api/v1/clinics/me — the therapist's clinic(s). */
export const MyClinicsResponseSchema = z.object({
  clinics: z.array(ClinicSchema),
});
export type MyClinicsResponse = z.infer<typeof MyClinicsResponseSchema>;

export const UpdateClinicInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
});
export type UpdateClinicInput = z.infer<typeof UpdateClinicInputSchema>;
