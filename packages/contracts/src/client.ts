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

export const SessionModalitySchema = z.enum(['CBT', 'EMDR', 'OTHER']);

export const CreateClientInputSchema = z.object({
  fullName: z.string().min(1).max(200),
  contactPhone: IndianPhoneSchema,
  contactEmail: z.string().email().optional(),
  dateOfBirth: IsoDateSchema.optional(),
  presentingConcerns: z.string().max(2000).optional(),
  preferredModality: SessionModalitySchema.optional(),
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
  status: ClientStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ListClientsQuerySchema = z.object({
  status: ClientStatusSchema.optional(),
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
