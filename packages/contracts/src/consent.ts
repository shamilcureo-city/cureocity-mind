import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema, ScriptVersionSchema } from './common';

export const ConsentScopeSchema = z.enum([
  'AUDIO_RECORDING',
  'AI_NOTE_GENERATION',
  'CROSS_BORDER_PROCESSING',
  'DATA_RETENTION_EXTENDED',
]);

export const ConsentStatusSchema = z.enum(['GRANTED', 'WITHDRAWN', 'EXPIRED']);

export const ConsentCaptureChannelSchema = z.enum(['IN_PERSON', 'REMOTE_LINK', 'EMAIL']);

export const ConsentInputSchema = z.object({
  scope: ConsentScopeSchema,
  scriptVersion: ScriptVersionSchema,
  capturedVia: ConsentCaptureChannelSchema,
  notes: z.string().max(1000).optional(),
});

export const ConsentSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  scope: ConsentScopeSchema,
  status: ConsentStatusSchema,
  scriptVersion: z.string(),
  capturedVia: ConsentCaptureChannelSchema,
  grantedAt: IsoDateTimeSchema,
  withdrawnAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ConsentInput = z.infer<typeof ConsentInputSchema>;
export type Consent = z.infer<typeof ConsentSchema>;
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;
export type ConsentCaptureChannel = z.infer<typeof ConsentCaptureChannelSchema>;
