import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema, PaginationCursorSchema } from './common';

export const AuditActionSchema = z.enum([
  'PSYCHOLOGIST_REGISTERED',
  'PSYCHOLOGIST_UPDATED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_VIEWED',
  'CLIENT_BRIEFING_VIEWED',
  'CLIENT_SOFT_DELETED',
  'CONSENT_GRANTED',
  'CONSENT_WITHDRAWN',
  'CONSENT_EXPIRED',
  'SESSION_CREATED',
  'SESSION_CONSENT_RECORDED',
  'SESSION_STARTED',
  'SESSION_ENDED',
  'SESSION_CANCELLED',
  'AUDIO_CHUNK_UPLOADED',
  'NOTE_DRAFT_CREATED',
  'NOTE_DRAFT_VIEWED',
  'NOTE_SIGNED',
  'COST_CIRCUIT_TRIPPED',
  'CRISIS_FLAG_RAISED',
  'WORKFLOW_CREATED',
  'WORKFLOW_PHASE_TRANSITIONED',
  'WORKFLOW_COMPLETED',
  'WORKFLOW_GOAL_UPDATED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_DELETED',
  'EXERCISE_PRESCRIBED',
  'EMDR_PREPARATION_COMPLETED',
  'EMDR_TARGET_ADDED',
  'EMDR_TARGET_UPDATED',
  'AFFECT_BASELINE_VIEWED',
  'AFFECT_TREND_VIEWED',
  'EXERCISE_ASSIGNED',
  'EXERCISE_COMPLETION_RECORDED',
  'EXERCISE_SKIPPED',
  'MOOD_LOGGED',
  'JOURNAL_ENTRY_CREATED',
  'JOURNAL_ENTRY_UPDATED',
  'CLIENT_FIREBASE_LINKED',
  'AUDIO_RETENTION_PURGED',
  'CLIENT_CLAIM_TOKEN_ISSUED',
  'CLIENT_CLAIM_TOKEN_REDEEMED',
  'PUSH_SUBSCRIPTION_REGISTERED',
  'PUSH_SUBSCRIPTION_REVOKED',
  'NOTIFICATION_DISPATCHED',
  'TREATMENT_PLAN_WHATSAPP_SENT',
  'ADMIN_AUDIT_LOG_READ',
  'ADMIN_ROLE_GRANTED',
  'ADMIN_ROLE_REVOKED',
  'DSR_ACCESS_REQUESTED',
  'DSR_ACCESS_FULFILLED',
  'DSR_CORRECTION_REQUESTED',
  'DSR_ERASURE_REQUESTED',
  'DSR_ERASURE_FULFILLED',
  'DSR_NOMINATION_RECORDED',
  'DSR_GRIEVANCE_FILED',
  'DSR_CONSENT_WITHDRAWN',
  'BOOKING_REQUESTED',
  'BOOKING_ACCEPTED',
  'BOOKING_DECLINED',
  'BOOKING_CANCELLED',
  'INTAKE_SUBMITTED',
  'INTAKE_REVIEWED',
  'INTAKE_MATCHED',
  // Clinical co-pilot — Sprint 13.
  // Pass 3 produces a ClinicalReport per session; the therapist
  // accepts/modifies/rejects each section. Confirmed sections
  // persist to ClientDiagnosis + TreatmentPlan.
  'CLINICAL_REPORT_GENERATED',
  'CLINICAL_SECTION_CONFIRMED',
  'DIAGNOSIS_CONFIRMED',
  'PLAN_CONFIRMED',
  'CRISIS_ACKNOWLEDGED',
  // Therapy script — Sprint 14. Pass 4 generates a per-therapy
  // script keyed by (client, therapy, language, inputs-hash);
  // cached + audited so re-views don't re-bill and the regulator
  // can replay what the therapist viewed.
  'THERAPY_SCRIPT_GENERATED',
  'THERAPY_SCRIPT_VIEWED',
  // Patient CRM / sharing — Sprint 15.
  // Every Send-to-patient click writes ARTEFACT_SHARED with the
  // channel + outcome; portal opens write PORTAL_OPENED.
  'PATIENT_ARTEFACT_SHARED',
  'PATIENT_PORTAL_OPENED',
  // Pre-session brief + scored instruments + crisis pathway — Sprint 17.
  'PRE_SESSION_BRIEF_GENERATED',
  'PRE_SESSION_BRIEF_VIEWED',
  'INSTRUMENT_ADMINISTERED',
  'INSTRUMENT_VIEWED',
  'SAFETY_PLAN_CREATED',
  'SAFETY_PLAN_UPDATED',
  // Therapist settings + WebAuthn credentials — Sprint 18.
  'WEBAUTHN_CREDENTIAL_REGISTERED',
  'WEBAUTHN_CREDENTIAL_REVOKED',
  // Scribing flow revamp — Sprint 19. INFERRED = session-defaults
  // cascade picked the modality from history; OVERRIDDEN = therapist
  // edited the cascade-picked value before submitting.
  'SESSION_MODALITY_INFERRED',
  'SESSION_MODALITY_OVERRIDDEN',
  // Measurement-based care progress reports — Sprint 20. Distinct from
  // PATIENT_ARTEFACT_SHARED so the competency dashboard can attribute
  // outcome-sharing separately. Generated audit fires whenever the
  // progress-report snapshot is built (even before a share is dispatched).
  'PATIENT_PROGRESS_REPORT_GENERATED',
  'PATIENT_PROGRESS_REPORT_SHARED',
  // Treatment-episode lifecycle — Sprint 20 Phase 3. OPENED when a
  // session is created with no active episode; CLOSED on discharge /
  // transfer (terminal state for the care arc).
  'TREATMENT_EPISODE_OPENED',
  'TREATMENT_EPISODE_CLOSED',
  // Per-goal achievement toggle — Sprint 20 Phase 3 follow-up.
  'TREATMENT_GOAL_PROGRESS_UPDATED',
  // Running-differential assessment items + case briefing — Sprint 22.
  'ASSESSMENT_ITEM_CREATED',
  'ASSESSMENT_ITEM_CLOSED',
  'CASE_BRIEFING_GENERATED',
]);

export const AuditActorTypeSchema = z.enum(['PSYCHOLOGIST', 'SYSTEM', 'CLIENT']);

export const AuditMetadataSchema = z
  .object({
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    requestId: z.string().optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .passthrough();

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;
export type AuditMetadata = z.infer<typeof AuditMetadataSchema>;

// ============================================================================
// Admin audit-log read — Sprint 9 PR 1.
//
// Returns a slice of the AuditLog table with composable filters. Every
// call writes its own ADMIN_AUDIT_LOG_READ row (audit-of-the-audit) so
// the activity of admins reviewing the log is itself reviewable.
// ============================================================================

export const AuditLogQuerySchema = z.object({
  /** ISO datetime — inclusive lower bound on createdAt. */
  from: IsoDateTimeSchema.optional(),
  /** ISO datetime — exclusive upper bound on createdAt. */
  to: IsoDateTimeSchema.optional(),
  action: AuditActionSchema.optional(),
  actorPsychologistId: CuidSchema.optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: CuidSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  cursor: PaginationCursorSchema,
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogEntrySchema = z.object({
  id: CuidSchema,
  actorType: AuditActorTypeSchema,
  actorPsychologistId: CuidSchema.nullable(),
  action: AuditActionSchema,
  targetType: z.string(),
  targetId: z.string(),
  metadata: AuditMetadataSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogPageSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  nextCursor: CuidSchema.nullable(),
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;
