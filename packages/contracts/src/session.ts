import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema, ScriptVersionSchema } from './common';
import { SessionKindSchema, SessionModalitySchema } from './client';
import { SessionStatusSchema } from './briefing';
import { ClinicalLocaleSchema } from './clinical';
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

/// Sprint 45 — Today screen no-show transition. The client never
/// arrived for the scheduled slot. `note` is an optional free-text
/// observation captured by the therapist.
export const SessionNoShowInputSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/// Sprint 45 — Today screen reschedule transition. The slot is moved
/// to a new time; the existing session is marked RESCHEDULED and a
/// fresh SCHEDULED session is created at the new time so audit
/// history is preserved (we never silently overwrite scheduledAt).
export const SessionRescheduleInputSchema = z.object({
  newScheduledAt: IsoDateTimeSchema,
  reason: z.string().trim().max(500).optional(),
});

export type SessionNoShowInput = z.infer<typeof SessionNoShowInputSchema>;
export type SessionRescheduleInput = z.infer<typeof SessionRescheduleInputSchema>;

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

/// Sprint 19 — which rung of the session-defaults cascade produced
/// the modality the panel is about to submit. Drives the
/// "from active plan" / "from client preference" hint under the
/// modality select, and the SESSION_MODALITY_OVERRIDDEN audit when
/// the therapist edits it.
export const ModalitySourceSchema = z.enum([
  'plan',
  'client',
  'therapist',
  'intake-fallback',
  'last-resort',
]);

/// Sprint 19 — output of GET /api/v1/clients/:id/session-defaults.
/// Feeds the Pre-Flight panel: the panel pre-fills every field
/// from this payload so the therapist only edits what they want.
export const SessionDefaultsSchema = z.object({
  kind: SessionKindSchema,
  modality: SessionModalitySchema.nullable(),
  modalitySource: ModalitySourceSchema,
  language: ClinicalLocaleSchema,
  spokenLanguages: z.array(z.string()),
  consentsAlreadyGranted: z.array(ConsentScopeSchema),
  consentsNeeded: z.array(ConsentScopeSchema),
  sessionsCompleted: z.number().int().nonnegative(),
  /// Per-instrument key (PHQ9, GAD7) → ISO timestamp of the most
  /// recent administration, or null if never administered.
  lastInstrumentAdministrations: z.record(z.string(), z.string().nullable()),
  /// ISO timestamp of the most recent COMPLETED session, or null if
  /// none. Drives the "Last: 2d ago" copy on the Record-page client
  /// tile. Optional in the contract so consumers built before this
  /// field still validate.
  lastCompletedSessionAt: z.string().nullable().optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type SessionConsentAckInput = z.infer<typeof SessionConsentAckInputSchema>;
export type SessionConsentSnapshot = z.infer<typeof SessionConsentSnapshotSchema>;
export type SessionConsentSnapshotEntry = z.infer<typeof SessionConsentSnapshotEntrySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ModalitySource = z.infer<typeof ModalitySourceSchema>;
export type SessionDefaults = z.infer<typeof SessionDefaultsSchema>;
