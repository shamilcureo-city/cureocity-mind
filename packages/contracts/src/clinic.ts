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

// ============================================================================
// Phase 2 (Sprint 42) — clinic admin powers. Visibility stays private to the
// treating therapist; these add member management, aggregate metrics, and
// client reassignment (custody transfer). Admins never see clinical content.
// ============================================================================

/** Add a member by their registered email. Adding to a SOLO clinic makes it GROUP. */
export const AddClinicMemberInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: ClinicRoleSchema.optional(),
});
export type AddClinicMemberInput = z.infer<typeof AddClinicMemberInputSchema>;

export const UpdateClinicMemberInputSchema = z.object({
  role: ClinicRoleSchema,
});
export type UpdateClinicMemberInput = z.infer<typeof UpdateClinicMemberInputSchema>;

/** Counts only — no client names or clinical content. */
export const ClinicMemberMetricsSchema = z.object({
  psychologistId: CuidSchema,
  fullName: z.string(),
  role: ClinicRoleSchema,
  activeClients: z.number().int(),
  sessions30d: z.number().int(),
  sessionsLifetime: z.number().int(),
});
export type ClinicMemberMetrics = z.infer<typeof ClinicMemberMetricsSchema>;

export const ClinicMetricsResponseSchema = z.object({
  clinicId: CuidSchema,
  members: z.array(ClinicMemberMetricsSchema),
});
export type ClinicMetricsResponse = z.infer<typeof ClinicMetricsResponseSchema>;

/**
 * Reassign custody to `toPsychologistId`. Either one client (`clientId`)
 * or a whole caseload (`fromPsychologistId` — the departure flow, the only
 * one the admin UI exposes since admins never see individual client names).
 */
export const ReassignClientInputSchema = z
  .object({
    toPsychologistId: CuidSchema,
    clientId: CuidSchema.optional(),
    fromPsychologistId: CuidSchema.optional(),
  })
  .refine((d) => d.clientId !== undefined || d.fromPsychologistId !== undefined, {
    message: 'Provide clientId (one client) or fromPsychologistId (whole caseload).',
  });
export type ReassignClientInput = z.infer<typeof ReassignClientInputSchema>;
