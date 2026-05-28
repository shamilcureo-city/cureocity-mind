import { z } from 'zod';
import { CuidSchema, IndianPhoneSchema, IsoDateTimeSchema } from './common';
import { ConsentScopeSchema } from './consent';

// ============================================================================
// DPDP Act Data Subject Rights — § 11 access, § 12 correction,
// § 13 nomination, § 13 withdraw consent, § 14 grievance, § 15 erasure.
// Implemented as a single /me/dsr surface on patient-model-service so
// the data fiduciary (Cureocity Mind) has one audit trail for all
// patient rights exercises. Sprint 9 PR 2.
// ============================================================================

// --- § 11: Right to access ---------------------------------------------------

export const DsrDataExportSchema = z.object({
  exportedAt: IsoDateTimeSchema,
  client: z.object({
    id: CuidSchema,
    fullName: z.string(),
    contactPhone: z.string(),
    contactEmail: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    presentingConcerns: z.string().nullable(),
    preferredModality: z.string().nullable(),
    status: z.string(),
    createdAt: IsoDateTimeSchema,
  }),
  psychologist: z.object({
    id: CuidSchema,
    fullName: z.string(),
    email: z.string(),
  }),
  consents: z.array(
    z.object({
      scope: ConsentScopeSchema,
      status: z.string(),
      scriptVersion: z.string(),
      grantedAt: IsoDateTimeSchema,
      withdrawnAt: IsoDateTimeSchema.nullable(),
    }),
  ),
  /** Counts only — full session content is exported separately for size. */
  sessionCount: z.number().int().nonnegative(),
  moodLogCount: z.number().int().nonnegative(),
  journalEntryCount: z.number().int().nonnegative(),
  exerciseAssignmentCount: z.number().int().nonnegative(),
  nominations: z.array(
    z.object({
      id: CuidSchema,
      nomineeName: z.string(),
      nomineeRelation: z.string(),
      createdAt: IsoDateTimeSchema,
      supersededAt: IsoDateTimeSchema.nullable(),
    }),
  ),
  erasureRequests: z.array(
    z.object({
      id: CuidSchema,
      status: z.string(),
      createdAt: IsoDateTimeSchema,
      resolvedAt: IsoDateTimeSchema.nullable(),
    }),
  ),
  grievances: z.array(
    z.object({
      id: CuidSchema,
      subject: z.string(),
      status: z.string(),
      createdAt: IsoDateTimeSchema,
      resolvedAt: IsoDateTimeSchema.nullable(),
    }),
  ),
});
export type DsrDataExport = z.infer<typeof DsrDataExportSchema>;

// --- § 12: Right to correction -----------------------------------------------

export const DsrCorrectionInputSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    contactPhone: IndianPhoneSchema.optional(),
    contactEmail: z.string().email().nullable().optional(),
    /** Free-text reason explaining what's being corrected and why. */
    reason: z.string().min(1).max(1000),
  })
  .refine(
    (d) => d.fullName !== undefined || d.contactPhone !== undefined || d.contactEmail !== undefined,
    {
      message: 'At least one field (fullName, contactPhone, contactEmail) must be supplied',
    },
  );
export type DsrCorrectionInput = z.infer<typeof DsrCorrectionInputSchema>;

// --- § 13: Right to nominate -------------------------------------------------

export const DsrNominationInputSchema = z.object({
  nomineeName: z.string().min(1).max(200),
  nomineeRelation: z.string().min(1).max(100),
  nomineePhone: IndianPhoneSchema,
  nomineeEmail: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});
export type DsrNominationInput = z.infer<typeof DsrNominationInputSchema>;

export const DsrNominationSchema = z.object({
  id: CuidSchema,
  nomineeName: z.string(),
  nomineeRelation: z.string(),
  nomineePhone: z.string(),
  nomineeEmail: z.string().nullable(),
  notes: z.string().nullable(),
  supersededAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type DsrNomination = z.infer<typeof DsrNominationSchema>;

// --- § 13: Right to withdraw consent -----------------------------------------

export const DsrConsentWithdrawalInputSchema = z.object({
  scope: ConsentScopeSchema,
  reason: z.string().max(1000).optional(),
});
export type DsrConsentWithdrawalInput = z.infer<typeof DsrConsentWithdrawalInputSchema>;

// --- § 14: Right to grievance ------------------------------------------------

export const DsrGrievanceInputSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});
export type DsrGrievanceInput = z.infer<typeof DsrGrievanceInputSchema>;

export const DsrGrievanceSchema = z.object({
  id: CuidSchema,
  subject: z.string(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED']),
  createdAt: IsoDateTimeSchema,
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type DsrGrievance = z.infer<typeof DsrGrievanceSchema>;

// --- § 15: Right to erasure --------------------------------------------------

export const DsrErasureInputSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type DsrErasureInput = z.infer<typeof DsrErasureInputSchema>;

export const DsrErasureSchema = z.object({
  id: CuidSchema,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED']),
  reason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
  resolutionNotes: z.string().nullable(),
});
export type DsrErasure = z.infer<typeof DsrErasureSchema>;
