import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema } from './clinical';
import { InstrumentChangeSchema, InstrumentKeySchema } from './instrument';

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
  /// Sprint 20 — client-facing pre→post progress report. Built
  /// deterministically from the reliable-change engine + the active
  /// treatment plan. The artefact the user said the product was
  /// missing: a "here's your result" the client walks away with.
  'PROGRESS_REPORT',
  /// Sprint 47 — the first INTERACTIVE artefact. The therapist sends a
  /// PHQ-9 / GAD-7 the client completes themselves from the portal
  /// between sessions; the public submit route scores it into the
  /// same InstrumentResponse trend the in-session runner feeds.
  'INSTRUMENT_CHECKIN',
  /// Sprint 49 — the intake-note counterpart to SIGNED_NOTE. Distinct
  /// snapshot shape (intake sections instead of SOAP four), so the
  /// portal can render the right form without widening the existing
  /// SignedNoteSnapshotSchema (and breaking pre-S49 shares' parses).
  'SIGNED_INTAKE_NOTE',
  /// Sprint DV3 — doctor after-visit summary. Patient-facing recap built
  /// deterministically from the signed medical encounter note.
  'AFTER_VISIT_SUMMARY',
  /// Sprint DV7 — doctor chronic-disease progress report. Patient-facing
  /// plain-language control trajectory ("BP 150/90 → 130/80 over 8
  /// visits"), built deterministically from the chronic-reading series.
  'CHRONIC_PROGRESS_REPORT',
  /// Sprint DS5-fu — doctor prescription pad. Patient-facing, shareable
  /// Indian Rx built deterministically from the session's SIGNED RxPadV1
  /// (TherapyNote.rxPad — confirmed medications only; pending/AI-suggested
  /// rows never reach the patient).
  'RX_PAD',
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
  // SHARE-1 — the therapist pulled the link back. Terminal: the portal
  // stops rendering the artefact and no longer audits opens.
  'REVOKED',
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
  /**
   * Sprint 51 — homework loop. When the share route persists the
   * script's homework as an ExerciseAssignment, the assignment id is
   * embedded here so the public Mark-as-done route can find it
   * without re-querying. The two completion fields flip when the
   * client marks done from the portal. All three are optional +
   * defaulted so pre-S51 THERAPY_SCRIPT snapshots keep parsing on
   * the portal (same back-compat trick S47 used for INSTRUMENT_CHECKIN).
   */
  homeworkAssignmentId: CuidSchema.nullable().default(null),
  homeworkCompleted: z.boolean().default(false),
  homeworkCompletedAt: IsoDateTimeSchema.nullable().default(null),
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

/**
 * Sprint 20 — Progress report snapshot.
 *
 * Plain-language, encouraging pre→post for each scored instrument the
 * client has been administered, plus the active treatment plan's goals
 * if one exists. Built deterministically from the reliable-change
 * engine (NO LLM); the portal renders it visually so the client sees a
 * real, measured result from their work in therapy.
 *
 * The headline is the most clinically meaningful change across
 * available instruments (improving > stable > worsening). Per-instrument
 * narrative + chip strings are pre-rendered server-side so the portal
 * stays a thin renderer.
 */
export const ProgressReportInstrumentEntrySchema = z.object({
  /** "PHQ-9 · depression" / "GAD-7 · anxiety". */
  label: z.string().min(1),
  /** Plain-language sentence ("you started at 18, you're at 7 …"). */
  narrative: z.string().min(1).max(800),
  /** Short tone chip ("Reliable improvement" / "Stable" / "Worsening"). */
  verdictChip: z.string().min(1).max(60),
  /** Numeric details for the chart strip. */
  change: InstrumentChangeSchema,
});
export type ProgressReportInstrumentEntry = z.infer<typeof ProgressReportInstrumentEntrySchema>;

export const ProgressReportSnapshotSchema = z.object({
  kind: z.literal('PROGRESS_REPORT'),
  /** Headline sentence shown in large type at the top of the portal. */
  headline: z.string().min(1).max(400),
  /** Optional intro paragraph the therapist personalises in the modal. */
  intro: z.string().max(2000).nullable(),
  /** Number of sessions the report covers. */
  sessionsCompleted: z.number().int().nonnegative(),
  /** When treatment started — first completed session. Null on intake. */
  startedAt: IsoDateTimeSchema.nullable(),
  /** Per-instrument plain-language pre→post. */
  instruments: z.array(ProgressReportInstrumentEntrySchema),
  /** Active treatment plan goals if one exists. */
  goals: z.array(z.object({ description: z.string(), measure: z.string() })),
  /** Three short encouraging lines tailored to the verdict. */
  encouragements: z.array(z.string().min(1).max(400)).min(1).max(5),
});
export type ProgressReportSnapshot = z.infer<typeof ProgressReportSnapshotSchema>;

/**
 * Sprint 47 — Instrument check-in snapshot.
 *
 * Unlike every other snapshot (which the portal renders read-only),
 * this one carries an instrument the client FILLS OUT. The items +
 * scale are snapshotted at send time so the form is stable and the
 * portal needs no clinical-package import. `completed` flips to true
 * when the public submit route stores the response, so re-opening the
 * link shows a thank-you instead of a blank form.
 *
 * `riskItemNumber` (PHQ-9 #9) lets the portal show crisis resources
 * the instant the client endorses self-harm — a clinician isn't in
 * the room, so the safety net has to be in the form itself.
 */
export const InstrumentCheckinItemSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  text: z.string().min(1),
});

export const InstrumentCheckinScaleOptionSchema = z.object({
  value: z.number().int().min(0).max(3),
  label: z.string().min(1),
});

export const InstrumentCheckinSnapshotSchema = z.object({
  kind: z.literal('INSTRUMENT_CHECKIN'),
  instrumentKey: InstrumentKeySchema,
  title: z.string().min(1),
  recallWindow: z.string().min(1),
  items: z.array(InstrumentCheckinItemSchema).min(1).max(20),
  scale: z.array(InstrumentCheckinScaleOptionSchema).min(2).max(6),
  /** 1-based index of the suicidality item (PHQ-9 #9), or null. */
  riskItemNumber: z.number().int().positive().nullable(),
  /** Flips true once the client submits; gates form vs thank-you. */
  completed: z.boolean(),
  completedAt: IsoDateTimeSchema.nullable(),
});
export type InstrumentCheckinSnapshot = z.infer<typeof InstrumentCheckinSnapshotSchema>;

/**
 * Sprint 49 — Intake-note snapshot. Patient-appropriate subset of the
 * intake note: what was discussed and the immediate plan, with optional
 * therapist intro. Intentionally excludes MSE, working hypothesis,
 * family / past-psychiatric history — those carry clinically sensitive
 * content that needs an explicit clinician sign-off before sharing, and
 * the patient doesn't need them to act on the plan. The portal renders
 * each section as a titled body block (same pattern as ProgressReport).
 */
export const SignedIntakeNoteSnapshotSectionSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
});
export type SignedIntakeNoteSnapshotSection = z.infer<typeof SignedIntakeNoteSnapshotSectionSchema>;

export const SignedIntakeNoteSnapshotSchema = z.object({
  kind: z.literal('SIGNED_INTAKE_NOTE'),
  /// Ordered patient-friendly sections rendered by the portal. The
  /// builder picks them from the intake note's presentingConcerns +
  /// immediatePlan (and any therapist-provided intro).
  sections: z.array(SignedIntakeNoteSnapshotSectionSchema).min(1).max(6),
  /// Optional URL to the signed-intake PDF (presigned, time-bounded).
  pdfUrl: z.string().url().nullable(),
});
export type SignedIntakeNoteSnapshot = z.infer<typeof SignedIntakeNoteSnapshotSchema>;

/**
 * Sprint DV3 — Doctor after-visit summary. A plain-language, patient-facing
 * recap built deterministically from the SIGNED medical encounter note (no
 * LLM). The portal renders each non-empty list; the builder keeps it honest
 * (no extracted meds / red-flags in this MVP — those arrive with DV5/DV6).
 */
export const AfterVisitSummarySnapshotSchema = z.object({
  kind: z.literal('AFTER_VISIT_SUMMARY'),
  /** Friendly opener (lower-case start; the portal prefixes "Hi <name>, "). */
  greeting: z.string().max(2000),
  whatWeDiscussed: z.array(z.string().min(1).max(800)),
  medications: z.array(z.string().min(1).max(400)),
  instructions: z.array(z.string().min(1).max(800)),
  followUp: z.string().max(800),
  redFlags: z.array(z.string().min(1).max(400)),
});
export type AfterVisitSummarySnapshot = z.infer<typeof AfterVisitSummarySnapshotSchema>;

/**
 * Sprint DV7 — chronic-disease progress report snapshot. Patient-facing,
 * deterministic (no LLM). One row per tracked measure (BP, HbA1c, …) with
 * a plain-language line, plus an overall headline. The portal renders the
 * lines; the builder strips clinical jargon.
 */
export const ChronicProgressReportSnapshotSchema = z.object({
  kind: z.literal('CHRONIC_PROGRESS_REPORT'),
  greeting: z.string().max(2000),
  headline: z.string().max(800),
  /** One plain-language line per measure ("Your blood pressure improved…"). */
  measures: z.array(z.string().min(1).max(600)),
  encouragement: z.string().max(800),
});
export type ChronicProgressReportSnapshot = z.infer<typeof ChronicProgressReportSnapshotSchema>;

/**
 * Sprint DS5-fu — prescription-pad snapshot. Patient-facing, deterministic
 * (no LLM). Built from the session's SIGNED RxPadV1 (confirmed meds only),
 * with each medication pre-composed into a single plain line the portal
 * renders verbatim.
 */
export const RxPadSnapshotMedSchema = z.object({
  /** Pre-composed line, e.g. "Paracetamol 500mg · 1-0-1 · after food · for 5 days". */
  line: z.string().min(1).max(600),
  /** A continued/existing medicine (the portal badges it). */
  continued: z.boolean().default(false),
});
export type RxPadSnapshotMed = z.infer<typeof RxPadSnapshotMedSchema>;

export const RxPadSnapshotSchema = z.object({
  kind: z.literal('RX_PAD'),
  /** Friendly opener (lower-case; the portal prefixes "Hi <name>, "). */
  greeting: z.string().max(2000),
  /** Diagnosis / impression line, plain language. */
  diagnosisLine: z.string().max(600),
  /** CONFIRMED medications only. */
  medications: z.array(RxPadSnapshotMedSchema),
  /** Investigations / tests advised. */
  investigations: z.array(z.string().min(1).max(400)),
  /** Plain-language advice lines. */
  advice: z.array(z.string().min(1).max(800)),
  /** Follow-up sentence, or empty. */
  followUp: z.string().max(400),
});
export type RxPadSnapshot = z.infer<typeof RxPadSnapshotSchema>;

export const PatientShareSnapshotSchema = z.discriminatedUnion('kind', [
  SignedNoteSnapshotSchema,
  ReflectionQuestionsSnapshotSchema,
  TherapyScriptSnapshotSchema,
  TreatmentPlanSnapshotSchema,
  ProgressReportSnapshotSchema,
  InstrumentCheckinSnapshotSchema,
  SignedIntakeNoteSnapshotSchema,
  AfterVisitSummarySnapshotSchema,
  ChronicProgressReportSnapshotSchema,
  RxPadSnapshotSchema,
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

/// Sprint 49 — share a signed intake note. Same payload shape as
/// SIGNED_NOTE (sessionId is the artefact id), distinct artefactType so
/// the route picks the intake-snapshot builder + portal branch.
export const ShareSignedIntakeNoteInputSchema = z.object({
  artefactType: z.literal('SIGNED_INTAKE_NOTE'),
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
  /**
   * Sprint 51 — when true, the share route persists the script's
   * `homework` field as an ExerciseAssignment (or reuses the open
   * row for the same script) so the client can mark it COMPLETED
   * from the portal and the pre-session brief reads real homework
   * truth. Optional (default treated as `true` at the call site) —
   * we deliberately avoid `.default()` here because it breaks the
   * discriminated union's input/output symmetry that other modules
   * rely on for assignment compatibility.
   */
  assignHomework: z.boolean().optional(),
});

/// Sprint 51 — public POST /api/v1/p/[token]/homework body. Empty —
/// the share token IS the auth, identical posture to S47's check-in
/// submit route. Spelled out as a schema for contracts-first parity.
export const HomeworkDoneInputSchema = z.object({});
export type HomeworkDoneInput = z.infer<typeof HomeworkDoneInputSchema>;

export const ShareTreatmentPlanInputSchema = z.object({
  artefactType: z.literal('TREATMENT_PLAN'),
  treatmentPlanId: CuidSchema,
});

/// Sprint 20 — Progress report is derived from cumulative client state
/// (instruments + plan); the only input is the clientId. The route fills
/// in the heavy lifting via apps/web/lib/progress-report.ts.
export const ShareProgressReportInputSchema = z.object({
  artefactType: z.literal('PROGRESS_REPORT'),
  clientId: CuidSchema,
});

/// Sprint 47 — send a self-serve check-in. The route snapshots the
/// instrument catalog (items + scale) at send time; the only inputs
/// are which client and which instrument.
export const ShareInstrumentCheckinInputSchema = z.object({
  artefactType: z.literal('INSTRUMENT_CHECKIN'),
  clientId: CuidSchema,
  instrumentKey: InstrumentKeySchema,
});

/// Sprint DV3 — share a doctor after-visit summary. sessionId is the
/// artefact id (same posture as SIGNED_NOTE); the snapshot is built from
/// the signed medical encounter note.
export const ShareAfterVisitSummaryInputSchema = z.object({
  artefactType: z.literal('AFTER_VISIT_SUMMARY'),
  sessionId: CuidSchema,
});

/// Sprint DV7 — share a chronic-disease progress report. clientId is the
/// artefact id (the report is per-patient, not per-encounter); the
/// snapshot is built from the chronic-reading trajectory.
export const ShareChronicProgressReportInputSchema = z.object({
  artefactType: z.literal('CHRONIC_PROGRESS_REPORT'),
  clientId: CuidSchema,
});

/// Sprint DS5-fu — share a prescription pad. sessionId is the artefact id
/// (same posture as SIGNED_NOTE / AFTER_VISIT_SUMMARY); the snapshot is
/// built from the session's signed RxPadV1 (confirmed meds only).
export const ShareRxPadInputSchema = z.object({
  artefactType: z.literal('RX_PAD'),
  sessionId: CuidSchema,
});

export const ShareArtefactRefSchema = z.discriminatedUnion('artefactType', [
  ShareSignedNoteInputSchema,
  ShareReflectionQuestionsInputSchema,
  ShareTherapyScriptInputSchema,
  ShareTreatmentPlanInputSchema,
  ShareProgressReportInputSchema,
  ShareInstrumentCheckinInputSchema,
  ShareSignedIntakeNoteInputSchema,
  ShareAfterVisitSummaryInputSchema,
  ShareChronicProgressReportInputSchema,
  ShareRxPadInputSchema,
]);
export type ShareArtefactRef = z.infer<typeof ShareArtefactRefSchema>;

/// Sprint 47 — public check-in submission from /p/<token>. The token
/// IS the auth; the route resolves the instrument + client from the
/// PatientShare row. `responses` is item-id → 0..3.
export const CheckinSubmitInputSchema = z.object({
  responses: z.record(z.string(), z.number().int().min(0).max(3)),
});
export type CheckinSubmitInput = z.infer<typeof CheckinSubmitInputSchema>;

export const ShareInputSchema = z
  .object({
    clientId: CuidSchema,
    channels: z.array(PatientShareChannelSchema).min(1, 'pick at least one channel').max(3),
    /** Optional therapist note shown to the patient above the artefact. */
    therapistMessage: z.string().max(2000).optional(),
    /** Optional language override; defaults to client.preferredLanguage. */
    language: ClinicalLocaleSchema.optional(),
    artefact: ShareArtefactRefSchema,
    /**
     * SHARE-3 — dry-run. When true, the route builds + translates the
     * snapshot and returns it for the therapist to review (the exact text
     * the patient will read), WITHOUT creating any PatientShare or sending
     * anything. The real send is a second call with preview omitted/false.
     */
    preview: z.boolean().optional(),
  })
  .strict();
export type ShareInput = z.infer<typeof ShareInputSchema>;

/**
 * SHARE-3 — response to a `preview: true` share request: the translated,
 * patient-facing snapshot the therapist confirms before the real send.
 */
export const SharePreviewResponseSchema = z.object({
  preview: z.literal(true),
  language: ClinicalLocaleSchema,
  snapshot: PatientShareSnapshotSchema,
});
export type SharePreviewResponse = z.infer<typeof SharePreviewResponseSchema>;

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
