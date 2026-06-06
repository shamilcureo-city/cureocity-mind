import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema } from './clinical';

/**
 * Sprint 15 — Patient CRM & sharing.
 *
 * The therapist can send any artefact (signed note, reflection
 * questions, therapy script, treatment plan) to the client via one
 * or more channels (WhatsApp, email, portal-only). Each share writes
 * a PatientShare row with:
 *   - A snapshot of the artefact body at share time so the patient
 *     always sees what was sent, even if the source row is later
 *     edited or deleted.
 *   - A 22-char base64url token that opens the read-only portal at
 *     /p/<token>.
 *   - Channel-specific delivery state (sent, opened, failures).
 *
 * The portal is the canonical surface; messages on each channel are
 * short and link to the portal URL. This keeps WhatsApp templates
 * within length limits and email content scannable.
 */

// ============================================================================
// Enums + tokens
// ============================================================================

export const PatientShareArtefactTypeSchema = z.enum([
  'SIGNED_NOTE',
  'REFLECTION_QUESTIONS',
  'THERAPY_SCRIPT',
  'TREATMENT_PLAN',
]);
export type PatientShareArtefactType = z.infer<typeof PatientShareArtefactTypeSchema>;

export const PatientShareChannelSchema = z.enum(['WHATSAPP', 'EMAIL', 'PORTAL_LINK']);
export type PatientShareChannel = z.infer<typeof PatientShareChannelSchema>;

export const PatientShareStatusSchema = z.enum([
  'PENDING',
  'SENT',
  'OPENED',
  'TRANSIENT_FAILURE',
  'PERMANENT_FAILURE',
]);
export type PatientShareStatus = z.infer<typeof PatientShareStatusSchema>;

/** 22-char base64url, matches the existing ClientClaimToken convention. */
export const PatientShareTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'must be 22-char base64url');
export type PatientShareToken = z.infer<typeof PatientShareTokenSchema>;

// ============================================================================
// Snapshot shapes — what the portal renders, locked at share time.
// Each artefact type carries its own discriminated shape so the
// portal can render typed content without parsing arbitrary JSON.
// ============================================================================

export const SignedNoteSnapshotSchema = z.object({
  kind: z.literal('SIGNED_NOTE'),
  /** Plain-text representation of the SOAP note, language-localised. */
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  /** Optional URL to the PDF version (presigned, time-bounded). */
  pdfUrl: z.string().url().nullable(),
});
export type SignedNoteSnapshot = z.infer<typeof SignedNoteSnapshotSchema>;

export const ReflectionQuestionsSnapshotSchema = z.object({
  kind: z.literal('REFLECTION_QUESTIONS'),
  questions: z.array(z.string().min(1).max(600)).min(1).max(10),
});
export type ReflectionQuestionsSnapshot = z.infer<typeof ReflectionQuestionsSnapshotSchema>;

export const TherapyScriptSnapshotSchema = z.object({
  kind: z.literal('THERAPY_SCRIPT'),
  therapyName: z.string(),
  /** Patient-friendly summary, NOT the verbatim therapist script. */
  patientSummary: z.string().min(1).max(4000),
  /** Homework lifted from the script for the patient to do at home. */
  homework: z.object({
    description: z.string(),
    deliveryNotes: z.string(),
  }),
});
export type TherapyScriptSnapshot = z.infer<typeof TherapyScriptSnapshotSchema>;

export const TreatmentPlanSnapshotSchema = z.object({
  kind: z.literal('TREATMENT_PLAN'),
  modality: z.string(),
  phaseSequence: z.array(z.string()),
  goals: z.array(z.object({ description: z.string(), measure: z.string() })),
  expectedDurationSessions: z.number().int().nullable(),
});
export type TreatmentPlanSnapshot = z.infer<typeof TreatmentPlanSnapshotSchema>;

export const PatientShareSnapshotSchema = z.discriminatedUnion('kind', [
  SignedNoteSnapshotSchema,
  ReflectionQuestionsSnapshotSchema,
  TherapyScriptSnapshotSchema,
  TreatmentPlanSnapshotSchema,
]);
export type PatientShareSnapshot = z.infer<typeof PatientShareSnapshotSchema>;

// ============================================================================
// PatientShare row DTO.
// ============================================================================

export const PatientShareSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  sessionId: CuidSchema.nullable(),
  artefactType: PatientShareArtefactTypeSchema,
  artefactId: z.string(),
  channel: PatientShareChannelSchema,
  status: PatientShareStatusSchema,
  shareToken: PatientShareTokenSchema,
  language: ClinicalLocaleSchema,
  snapshot: PatientShareSnapshotSchema,
  subject: z.string(),
  toContact: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  sentAt: IsoDateTimeSchema.nullable(),
  openedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PatientShare = z.infer<typeof PatientShareSchema>;

// ============================================================================
// POST /api/v1/share input. One request can fan out to multiple
// channels and produces one PatientShare row per channel.
// ============================================================================

export const ShareSignedNoteInputSchema = z.object({
  artefactType: z.literal('SIGNED_NOTE'),
  sessionId: CuidSchema,
});

export const ShareReflectionQuestionsInputSchema = z.object({
  artefactType: z.literal('REFLECTION_QUESTIONS'),
  sessionId: CuidSchema,
  /**
   * The questions to send. Snapshotted into the PatientShare row.
   * The UI already has them generated client-side; we trust + validate.
   */
  questions: z.array(z.string().min(1).max(600)).min(1).max(10),
});

export const ShareTherapyScriptInputSchema = z.object({
  artefactType: z.literal('THERAPY_SCRIPT'),
  therapyScriptId: CuidSchema,
});

export const ShareTreatmentPlanInputSchema = z.object({
  artefactType: z.literal('TREATMENT_PLAN'),
  treatmentPlanId: CuidSchema,
});

export const ShareArtefactRefSchema = z.discriminatedUnion('artefactType', [
  ShareSignedNoteInputSchema,
  ShareReflectionQuestionsInputSchema,
  ShareTherapyScriptInputSchema,
  ShareTreatmentPlanInputSchema,
]);
export type ShareArtefactRef = z.infer<typeof ShareArtefactRefSchema>;

export const ShareInputSchema = z
  .object({
    clientId: CuidSchema,
    channels: z
      .array(PatientShareChannelSchema)
      .min(1, 'pick at least one channel')
      .max(3),
    /** Optional therapist note shown to the patient above the artefact. */
    therapistMessage: z.string().max(2000).optional(),
    /** Optional language override; defaults to client.preferredLanguage. */
    language: ClinicalLocaleSchema.optional(),
    artefact: ShareArtefactRefSchema,
  })
  .strict();
export type ShareInput = z.infer<typeof ShareInputSchema>;

export const ShareResultEntrySchema = z.object({
  channel: PatientShareChannelSchema,
  shareId: CuidSchema,
  status: PatientShareStatusSchema,
  portalUrl: z.string(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});
export type ShareResultEntry = z.infer<typeof ShareResultEntrySchema>;

export const ShareResponseSchema = z.object({
  results: z.array(ShareResultEntrySchema),
});
export type ShareResponse = z.infer<typeof ShareResponseSchema>;

// ============================================================================
// GET /api/v1/clients/[id]/shares — history list.
// ============================================================================

export const ListPatientSharesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListPatientSharesQuery = z.infer<typeof ListPatientSharesQuerySchema>;

export const ListPatientSharesResponseSchema = z.object({
  items: z.array(PatientShareSchema),
});
export type ListPatientSharesResponse = z.infer<typeof ListPatientSharesResponseSchema>;
