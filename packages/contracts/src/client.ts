import { z } from 'zod';
import {
  CuidSchema,
  IndianPhoneSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  PaginationCursorSchema,
} from './common';
import { ConsentInputSchema } from './consent';

export const ClientStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DISCHARGED', 'TRANSFERRED']);

// Sprint 19 — expanded evidence-based modalities. Old V1 enum had
// only CBT | EMDR | OTHER, collapsing ACT/IFS/MI/MBCT/psychodynamic/
// supportive into a single "Other" bucket. INTAKE is a sentinel for
// first-session investigative work; modality only becomes a treatment
// choice after assessment + plan are confirmed.
export const SessionModalitySchema = z.enum([
  'CBT',
  'EMDR',
  'ACT',
  'IFS',
  'PSYCHODYNAMIC',
  'MI',
  'MBCT',
  'SUPPORTIVE',
  'INTAKE',
  'OTHER',
]);

/// Sprint 19 — session classification driving Pass 2/3 prompt branches.
export const SessionKindSchema = z.enum(['INTAKE', 'TREATMENT', 'REVIEW']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const CreateClientInputSchema = z.object({
  fullName: z.string().min(1).max(200),
  contactPhone: IndianPhoneSchema,
  contactEmail: z.string().email().optional(),
  dateOfBirth: IsoDateSchema.optional(),
  presentingConcerns: z.string().max(2000).optional(),
  preferredModality: SessionModalitySchema.optional(),
  /**
   * Sprint 16 — patient-facing language (ISO 639-1). Used for
   * reflection questions, therapy-script patient summaries, and the
   * /p/<token> portal view. Defaults to "en" at the DB layer.
   */
  preferredLanguage: z
    .string()
    .min(2)
    .max(8)
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  /**
   * Sprint 16 — the client's typical spoken languages, sorted by
   * prevalence. Therapist-provided hint for Pass 1 transcription
   * + Pass 4 verbatim-speech selection. Code-mixing is normal —
   * include each base language separately (e.g. ["ml", "en"] for a
   * Manglish speaker).
   */
  spokenLanguages: z
    .array(
      z
        .string()
        .min(2)
        .max(8)
        .regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    )
    .max(5)
    .optional(),
  consents: z
    .array(ConsentInputSchema)
    .min(1, 'At least one consent (typically AUDIO_RECORDING) is required when creating a client')
    .max(8),
});

export const UpdateClientInputSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    contactPhone: IndianPhoneSchema,
    contactEmail: z.string().email().nullable(),
    dateOfBirth: IsoDateSchema.nullable(),
    presentingConcerns: z.string().max(2000).nullable(),
    preferredModality: SessionModalitySchema.nullable(),
    /// Sprint 44 — editable post-intake so the therapist can fill in
    /// language preferences from the client page (the new-client form
    /// defers them). Same ISO 639-1 shape as CreateClientInputSchema.
    preferredLanguage: z
      .string()
      .min(2)
      .max(8)
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    spokenLanguages: z
      .array(
        z
          .string()
          .min(2)
          .max(8)
          .regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      )
      .max(5),
    status: ClientStatusSchema,
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });

export const ClientSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  fullName: z.string(),
  contactPhone: z.string(),
  contactEmail: z.string().nullable(),
  dateOfBirth: IsoDateSchema.nullable(),
  presentingConcerns: z.string().nullable(),
  preferredModality: SessionModalitySchema.nullable(),
  /** ISO 639-1 (default "en"). */
  preferredLanguage: z.string().default('en'),
  /** ISO 639-1 codes, may be empty. */
  spokenLanguages: z.array(z.string()).default([]),
  status: ClientStatusSchema,
  /**
   * Sprint 48 — true for the seeded "Example" showcase client. Badged
   * in the UI and excluded from metrics, competency rollups, and the
   * trial session cap. Defaults false for every real client.
   */
  isDemo: z.boolean().default(false),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/**
 * Sprint 48 — response from POST/DELETE the demo-client endpoint. On
 * POST, `created` is false when an existing demo client was returned
 * (idempotent re-seed). On DELETE, `removed` reflects whether a row
 * was actually deleted.
 */
export const DemoClientResponseSchema = z.object({
  clientId: CuidSchema.nullable(),
  created: z.boolean().optional(),
  removed: z.boolean().optional(),
});
export type DemoClientResponse = z.infer<typeof DemoClientResponseSchema>;

export const ListClientsQuerySchema = z.object({
  status: ClientStatusSchema.optional(),
  /// Sprint 44 — case-insensitive substring match on the client's full
  /// name so a therapist with a large caseload can find someone without
  /// scrolling. Empty/whitespace is treated as no filter by the route.
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: PaginationCursorSchema,
});

export const ListClientsResponseSchema = z.object({
  items: z.array(ClientSchema),
  nextCursor: CuidSchema.nullable(),
});

export type CreateClientInput = z.infer<typeof CreateClientInputSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientInputSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type ClientStatus = z.infer<typeof ClientStatusSchema>;
export type SessionModality = z.infer<typeof SessionModalitySchema>;
export type ListClientsQuery = z.infer<typeof ListClientsQuerySchema>;
export type ListClientsResponse = z.infer<typeof ListClientsResponseSchema>;

// ============================================================================
// Client claim flow — Sprint 8 PR 1.
// Psychologist issues a single-use, short-lived token; client redeems it
// after Firebase phone OTP to bind clientFirebaseUid to a Client row.
// ============================================================================

export const ClientClaimTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'must be 22-char base64url'),
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  expiresAt: IsoDateTimeSchema,
});
export type ClientClaimToken = z.infer<typeof ClientClaimTokenSchema>;

/**
 * Surfaced on the redeem screen before the user logs in — confirms which
 * therapist + which client name this QR belongs to so the patient doesn't
 * accidentally claim someone else's pairing.
 */
export const ClaimTokenPreviewSchema = z.object({
  clientFirstName: z.string(),
  psychologistFullName: z.string(),
  expiresAt: IsoDateTimeSchema,
  redeemed: z.boolean(),
});
export type ClaimTokenPreview = z.infer<typeof ClaimTokenPreviewSchema>;

export const ClaimTokenRedeemResultSchema = z.object({
  clientId: CuidSchema,
  clientFirstName: z.string(),
  psychologistFullName: z.string(),
  redeemedAt: IsoDateTimeSchema,
});
export type ClaimTokenRedeemResult = z.infer<typeof ClaimTokenRedeemResultSchema>;
