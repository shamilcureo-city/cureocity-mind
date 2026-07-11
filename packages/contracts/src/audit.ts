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
  // Sprint 45 — Today screen status transitions on scheduled sessions.
  'SESSION_NO_SHOW',
  'SESSION_RESCHEDULED',
  'AUDIO_CHUNK_UPLOADED',
  // Sprint 57 — transcribe-on-arrival.
  'TRANSCRIPT_SEGMENT_TRANSCRIBED',
  'TRANSCRIPT_SEGMENT_FAILED',
  'NOTE_DRAFT_CREATED',
  'NOTE_DRAFT_VIEWED',
  'NOTE_SIGNED',
  'NOTE_UNLOCKED',
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
  // Sprint TSC — the copilot decision board: questions the therapist ticked
  // to carry into the next session (stored on Client.carriedQuestions).
  'CARRIED_QUESTIONS_UPDATED',
  // Sprint TSC-V2 — decision-board wrap-up: therapist tapped "Finish review".
  'COPILOT_REVIEW_FINISHED',
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
  // SHARE-1 — the therapist pulled back a shared link (wrong recipient /
  // wrong artefact). The portal stops rendering it from that point on.
  'PATIENT_SHARE_REVOKED',
  // CLIN-1 — an immediate alert was dispatched to the owning therapist
  // because a remote self-check-in raised a safety concern.
  'THERAPIST_CRISIS_ALERTED',
  // Pre-session brief + scored instruments + crisis pathway — Sprint 17.
  'PRE_SESSION_BRIEF_GENERATED',
  'PRE_SESSION_BRIEF_VIEWED',
  'INSTRUMENT_ADMINISTERED',
  'INSTRUMENT_VIEWED',
  // Sprint 47 — client completed a self-serve check-in from the portal.
  'PATIENT_CHECKIN_SUBMITTED',
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
  'CONCEPTUAL_MAP_GENERATED',
  // Per-tenant envelope encryption rollout — Sprint 32 Phase 1.
  // Provisioned on first encrypt-for-tenant call; backfill runs
  // bulk-encrypt across legacy plaintext rows.
  'ENCRYPTION_KEY_PROVISIONED',
  'ENCRYPTION_BACKFILL_RAN',
  // Pilot invite codes — Sprint 37. Mint/redeem/revoke a signup gate.
  'PILOT_INVITE_CREATED',
  'PILOT_INVITE_REDEEMED',
  'PILOT_INVITE_REVOKED',
  // Multi-tenant clinics — Sprint 39 (foundation).
  'CLINIC_CREATED',
  'CLINIC_MEMBER_ADDED',
  // Multi-tenant clinics — Sprint 42 (Phase 2: admin powers).
  'CLINIC_MEMBER_REMOVED',
  'CLINIC_MEMBER_ROLE_CHANGED',
  'CLIENT_REASSIGNED',
  // Demo showcase client — Sprint 48. Seeded / removed in one click.
  'DEMO_CLIENT_CREATED',
  'DEMO_CLIENT_REMOVED',
  // Case Consult — Sprint 52. Structured second opinion when stuck.
  'CASE_CONSULT_GENERATED',
  // Billing — Sprint 53.
  'TRIAL_CAP_REACHED',
  'PLAN_UPGRADED',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  // Billing — Sprint 56. Paid tier hit its rolling-30-day session cap.
  'PLAN_CAP_REACHED',
  // Billing — Sprint 56. Renewal reminder dispatched (7/3/1 day pre-expiry).
  'BILLING_REMINDER_SENT',
  // Billing — Sprint 56 (Lever 4 #4). Self-serve plan lifecycle.
  'PLAN_PAUSED',
  'PLAN_RESUMED',
  'PLAN_CANCELLED',
  // Billing — Sprint 56 (Lever 4 #5). Post-lapse dunning nudge.
  'BILLING_DUNNING_SENT',
  // Billing — Sprint 56 (Lever 4 #3). GST invoice PDF downloaded.
  'INVOICE_DOWNLOADED',
  // Referral — Sprint 56 (Lever 3b).
  'REFERRAL_REDEEMED',
  'REFERRAL_REWARDED',
  // Doctor vertical — Sprint DV3. Medical encounter-note lifecycle (the
  // doctor analogue of NOTE_DRAFT_CREATED / NOTE_SIGNED).
  'ENCOUNTER_NOTE_DRAFTED',
  'ENCOUNTER_NOTE_SIGNED',
  // Doctor vertical — Sprint DV5. Rx + clinical-order lifecycle.
  'MEDICATION_ORDER_DRAFTED',
  'MEDICATION_ORDER_CONFIRMED',
  'MEDICATION_ORDER_DISCARDED',
  'CLINICAL_ORDER_DRAFTED',
  'CLINICAL_ORDER_CONFIRMED',
  'CLINICAL_ORDER_DISCARDED',
  // Doctor vertical — Sprint DV6. Differential-diagnosis pass.
  'DIFFERENTIAL_GENERATED',
  // Doctor vertical — Sprint DV7. Chronic-disease readings + report.
  'CLINICAL_READING_RECORDED',
  'PATIENT_CHRONIC_REPORT_SHARED',
  // Doctor vertical — Sprint DS5-fu. Prescription pad shared to the patient
  // (a prescribing/dispensing event, distinct from PATIENT_ARTEFACT_SHARED).
  'PATIENT_RX_PAD_SHARED',
  // Doctor vertical — Sprint DV8. ABDM/ABHA/FHIR interoperability.
  'ENCOUNTER_FHIR_EXPORTED',
  'ABHA_LINKED',
  'ABDM_PRESCRIPTION_PUSHED',
  // Case file export — Sprint 65. The therapist downloads the whole
  // client chart (diagnoses + plans + measures + sessions) as one PDF.
  'CASE_FILE_EXPORTED',
  // Discharge / treatment summary export — Sprint 65b. A clinician-facing
  // end-of-episode summary (distinct from the patient Progress Report).
  'DISCHARGE_SUMMARY_EXPORTED',
  // Letters — Sprint 66. A therapist-authored letter (referral / support).
  'LETTER_GENERATED',
  // Problem list — Sprint 67c. Per-client maintained problem list.
  'PROBLEM_LIST_ITEM_ADDED',
  'PROBLEM_LIST_ITEM_UPDATED',
  'PROBLEM_LIST_ITEM_REMOVED',
  // Sprint 73 — which problems a session worked on (session↔problem tags).
  'SESSION_PROBLEMS_TAGGED',
  // Supervision review — Sprint 68. A signed note was reviewed in supervision.
  'NOTE_REVIEW_RECORDED',
  // First-run welcome dismissed — durable per-therapist flag.
  'WELCOME_DISMISSED',
  // Sprint 70 — a note template was applied to a session (the note is
  // re-generated into that template's structure).
  'NOTE_TEMPLATE_APPLIED',
  // Doctor vertical — Sprint DS0. A live consult's token / cost / latency
  // meter was persisted (relayed from the streaming gateway on consult end).
  'LIVE_CONSULT_METERED',
  // Doctor vertical — Sprint DS3. Live copilot suggestion lifecycle (shown /
  // acted / dismissed / auto-resolved) — the safety trail + pilot dataset.
  'LIVE_SUGGESTION_SHOWN',
  'LIVE_SUGGESTION_ACTED',
  'LIVE_SUGGESTION_DISMISSED',
  'LIVE_SUGGESTION_AUTORESOLVED',
  // Doctor vertical — Sprint DS10-B. The plan composer edited the draft Rx
  // pad (adopt an AI suggestion / manual add / confirm / remove) — one row
  // per op, with { op, source, item } metadata. The prescribing trail.
  'RX_PAD_EDITED',
  // NEXT2 — the reclaim cron marks generations stranded IN_PROGRESS/PENDING
  // (function killed mid-run) as FAILED so the UI offers a re-run instead of
  // an infinite spinner. One row per reclaimed draft/report.
  'STUCK_GENERATION_RECLAIMED',
  // NEXT3 — the daily digest email nudging a therapist about completed
  // sessions whose notes are still unsigned. One row per digest sent (the
  // metadata istDay is the dedupe key).
  'UNSIGNED_NOTE_DIGEST_SENT',
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
