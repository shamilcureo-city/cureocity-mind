import { z } from 'zod';
import { CuidSchema, IndianPhoneSchema, IsoDateTimeSchema } from './common';
import { SessionModalitySchema } from './client';

export const PsychologistStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'OFFBOARDED',
]);

export const PsychologistRoleSchema = z.enum(['THERAPIST', 'ADMIN']);
export type PsychologistRole = z.infer<typeof PsychologistRoleSchema>;

/// Sprint DV1 — product vertical discriminator. One system, two faces:
/// THERAPIST (psychotherapy) vs DOCTOR (super-specialty OPD scribe).
/// See docs/DOCTOR_VERTICAL.md.
export const PractitionerVerticalSchema = z.enum(['THERAPIST', 'DOCTOR']);
export type PractitionerVertical = z.infer<typeof PractitionerVerticalSchema>;

export const RciNumberSchema = z
  .string()
  .regex(/^[A-Z]\d+$/, 'RCI number format: leading letter + digits (e.g. A12345)');

export const CreatePsychologistInputSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email(),
  phone: IndianPhoneSchema,
  rciNumber: RciNumberSchema,
});

// ============================================================================
// PATCH /api/v1/psychologists/me — Sprint 18.
// Therapist self-service profile editing. All fields optional; refuses
// empty body. RCI-number, email, phone are NOT settable here — those
// require re-verification (Sprint 19+).
// ============================================================================

const Iso639Schema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'must be an ISO 639-1 code');

export const UpdatePsychologistInputSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    headline: z.string().min(1).max(160).nullable(),
    bio: z.string().min(1).max(4000).nullable(),
    photoUrl: z.string().url().max(2000).nullable(),
    specialties: z.array(z.string().min(1).max(80)).max(20),
    languages: z.array(z.string().min(1).max(80)).max(10),
    modalities: z.array(z.string().min(1).max(40)).max(10),
    yearsOfExperience: z.number().int().min(0).max(80).nullable(),
    locationCity: z.string().min(1).max(120).nullable(),
    locationProvince: z.string().min(1).max(120).nullable(),
    sessionFeeInr: z.number().int().min(0).max(100_000).nullable(),
    isAcceptingNewClients: z.boolean(),
    /** Sprint 18 — default output language for new notes/briefs. ISO 639-1. */
    defaultOutputLanguage: Iso639Schema,
    /** Default modality picked when creating a new session for a client without preferredModality. */
    defaultModality: SessionModalitySchema.nullable(),
    /**
     * Backup email for account recovery if the phone-OTP path fails.
     * Verified separately by the recovery flow (Sprint 18 PR 2 — schema
     * only ships in V1).
     */
    backupEmail: z.string().email().max(320).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });
export type UpdatePsychologistInput = z.infer<typeof UpdatePsychologistInputSchema>;

export const PsychologistSchema = z.object({
  id: CuidSchema,
  firebaseUid: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string(),
  rciNumber: z.string(),
  rciVerifiedAt: IsoDateTimeSchema.nullable(),
  status: PsychologistStatusSchema,
  role: PsychologistRoleSchema,

  /// Sprint DV1 — product vertical. Defaults to THERAPIST so every
  /// pre-DV1 row + caller still validates without supplying it.
  vertical: PractitionerVerticalSchema.default('THERAPIST'),
  /// Sprint DV1 — doctor credential; NULL for therapists.
  medicalRegNumber: z.string().nullable().default(null),
  /// Sprint DV1 — doctor specialty; NULL for therapists.
  specialty: z.string().nullable().default(null),

  // Directory profile fields (Sprint 12-era, surfaced via PATCH /me in S18).
  headline: z.string().nullable(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  specialties: z.array(z.string()),
  languages: z.array(z.string()),
  modalities: z.array(z.string()),
  yearsOfExperience: z.number().int().nullable(),
  locationCity: z.string().nullable(),
  locationProvince: z.string().nullable(),
  sessionFeeInr: z.number().int().nullable(),
  isAcceptingNewClients: z.boolean(),

  // Sprint 18 — settings additions.
  defaultOutputLanguage: z.string().default('en'),
  defaultModality: SessionModalitySchema.nullable(),
  backupEmail: z.string().nullable(),

  // Sprint 31 — null until POST /api/v1/onboarding/complete runs.
  onboardingCompletedAt: IsoDateTimeSchema.nullable(),

  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CreatePsychologistInput = z.infer<typeof CreatePsychologistInputSchema>;
export type Psychologist = z.infer<typeof PsychologistSchema>;
export type PsychologistStatus = z.infer<typeof PsychologistStatusSchema>;
