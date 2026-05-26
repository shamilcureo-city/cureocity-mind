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
