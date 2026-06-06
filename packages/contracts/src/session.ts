import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema, ScriptVersionSchema } from './common';
import { SessionKindSchema, SessionModalitySchema } from './client';
import { SessionStatusSchema } from './briefing';
import { ConsentScopeSchema } from './consent';

export const CreateSessionInputSchema = z.object({
  clientId: CuidSchema,
  /// Sprint 19 — modality is now OPTIONAL on create. When absent
  /// the session-defaults cascade picks one (TreatmentPlan.modality
  /// → Client.preferredModality → Psychologist.defaultModality →
  /// INTAKE) and writes a SESSION_MODALITY_INFERRED audit row.
  modality: SessionModalitySchema.optional(),
  scheduledAt: IsoDateTimeSchema,
});

export const SessionConsentAckInputSchema = z.object({
  /**
   * Therapist confirms the client has acknowledged each consent scope for
   * THIS session, identifying the script revision recited.
   */
  scopes: z
    .array(ConsentScopeSchema)
    .min(1, 'at least one consent scope must be acknowledged')
    .max(8),
  scriptVersion: ScriptVersionSchema,
  notes: z.string().max(1000).optional(),
});

export const SessionConsentSnapshotEntrySchema = z.object({
  scope: ConsentScopeSchema,
  scriptVersion: ScriptVersionSchema,
  ackedAt: IsoDateTimeSchema,
});

export const SessionConsentSnapshotSchema = z.object({
  entries: z.array(SessionConsentSnapshotEntrySchema),
  notes: z.string().nullable(),
});

export const SessionSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  /// Sprint 19 — nullable (INTAKE sessions can defer the choice).
  modality: SessionModalitySchema.nullable(),
  /// Sprint 19 — session kind drives Pass 2/3 prompt branches +
  /// UI labels (Intake vs Treatment).
  kind: SessionKindSchema.default('TREATMENT'),
  status: SessionStatusSchema,
  scheduledAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  consentSnapshot: SessionConsentSnapshotSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type SessionConsentAckInput = z.infer<typeof SessionConsentAckInputSchema>;
export type SessionConsentSnapshot = z.infer<typeof SessionConsentSnapshotSchema>;
export type SessionConsentSnapshotEntry = z.infer<typeof SessionConsentSnapshotEntrySchema>;
export type Session = z.infer<typeof SessionSchema>;
