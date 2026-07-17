import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { SessionModalitySchema } from './client';

/**
 * Sprint 13 — Clinical Co-Pilot Pivot.
 *
 * After Pass 2 writes the TherapyNoteV1, Pass 3 (Clinical Analysis)
 * produces a ClinicalReportV1 for the same session. The report is the
 * decision-support surface for the therapist: it proposes diagnosis
 * candidates with ICD-11 codes, the assessment data still needed, a
 * case formulation, a treatment plan, recommended therapies, and any
 * crisis flags. Each section carries the AI's confidence + citations
 * back into the transcript so the therapist can verify.
 *
 * The therapist reviews each section in the Clinical Brief tab and
 * marks it accepted / modified / rejected; confirmed diagnosis and
 * plan sections persist to ClientDiagnosis and TreatmentPlan
 * (cumulative across sessions).
 *
 * NOTE: ICD-11 codes (icd11Code / icd11Label) are kept in WHO English
 * regardless of the report language — they are international identifiers.
 */

// ============================================================================
// Locale — the ISO 639-1 of any narrative text in the report. V1 supports
// English and Malayalam in the UI; Hindi/Tamil/Bengali are listed so the
// schema doesn't have to change when those land.
// ============================================================================

export const ClinicalLocaleSchema = z.enum(['en', 'ml', 'hi', 'ta', 'bn']);
export type ClinicalLocale = z.infer<typeof ClinicalLocaleSchema>;

// ============================================================================
// Supporting evidence — a verbatim quote from the transcript with its
// timestamp. The Pass 3 prompt requires each diagnosis candidate and
// each crisis flag to cite at least one quote so the therapist can
// click through to the relevant moment in the session.
// ============================================================================

export const ClinicalSupportingQuoteSchema = z.object({
  quote: z.string().min(1).max(4000),
  speaker: z.enum(['client', 'therapist', 'unknown']),
  /** Start time in ms from audio start; matches SpeakerSegment.startMs. */
  startMs: z.number().int().nonnegative(),
});
export type ClinicalSupportingQuote = z.infer<typeof ClinicalSupportingQuoteSchema>;

// ============================================================================
// Diagnosis candidate — one possible ICD-11 diagnosis the AI is
// suggesting for this client based on the session. The therapist
// later picks one (or none) as primary.
// ============================================================================

export const Icd11CodeSchema = z
  .string()
  .min(2)
  .max(16)
  // ICD-11 codes are 2-7 chars: a digit + letter, then alphanumerics
  // and dots. We don't try to validate chapter membership in Zod; the
  // prompt enforces chapter 06 + post-confirmation we can build a
  // small reference list. Loose regex keeps schema permissive of
  // sub-codes like "6B01.0".
  .regex(/^[0-9][A-Z][A-Z0-9.]*$/, 'must look like an ICD-11 code (e.g. 6B01 or 6B01.0)');
export type Icd11Code = z.infer<typeof Icd11CodeSchema>;

export const ClinicalDiagnosisCandidateSchema = z.object({
  icd11Code: Icd11CodeSchema,
  /** WHO's official English label. Stays English even when report.language != 'en'. */
  icd11Label: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
  supportingEvidence: z.array(ClinicalSupportingQuoteSchema).min(1).max(6),
  /** Open questions / observations still needed to confirm this candidate. */
  gapsToFill: z.array(z.string().min(1).max(400)).max(8).default([]),
});
export type ClinicalDiagnosisCandidate = z.infer<typeof ClinicalDiagnosisCandidateSchema>;

// ============================================================================
// Assessment gap — an open question the therapist should ask next
// session. Distinct from gapsToFill on a single candidate because
// some gaps apply across candidates.
//
// Sprint TSC-V2 — the assessment ENGINE. A gap is no longer a flat
// question; it carries the JOB it does in narrowing the case:
//
//   - safety        — a risk question that must be asked first
//   - differentiate — tells two-or-more candidates apart (targets = the
//                     ICD codes it decides between)
//   - confirm       — establishes an unconfirmed criterion of the leading
//                     candidate (targets = that one code)
//   - context       — background that shapes formulation / plan (no target)
//
// Pass 3 is required to cover the differential systematically: a
// differentiate question for each pair of leading candidates and confirm
// questions for the leader's open criteria. Because the pass reads the
// cumulative record and is told not to re-ask what's already answered,
// the list SHRINKS session over session — an empty list means the
// differential has resolved (the board shows "assessment complete").
//
// Both fields are OPTIONAL so every pre-V2 stored gap still parses; the UI
// falls back to an "other" group when purpose is absent.
// ============================================================================

export const AssessmentGapPurposeSchema = z.enum(['safety', 'differentiate', 'confirm', 'context']);
export type AssessmentGapPurpose = z.infer<typeof AssessmentGapPurposeSchema>;

export const ClinicalAssessmentGapSchema = z.object({
  question: z.string().min(1).max(600),
  rationale: z.string().min(1).max(600),
  /// What job this question does. Optional — pre-V2 rows omit it.
  purpose: AssessmentGapPurposeSchema.optional(),
  /// The ICD-11 codes this question decides between (differentiate) or
  /// confirms (a single code). Permissive string (not the strict code
  /// regex) so display never breaks on a stem variant; empty for
  /// safety/context questions.
  targets: z.array(z.string().min(1).max(16)).max(6).default([]),
});
export type ClinicalAssessmentGap = z.infer<typeof ClinicalAssessmentGapSchema>;

// ============================================================================
// Treatment goal — measurable, with a measure the client + therapist
// can use to check progress.
// ============================================================================

export const ClinicalGoalSchema = z.object({
  description: z.string().min(1).max(400),
  measure: z.string().min(1).max(400),
});
export type ClinicalGoal = z.infer<typeof ClinicalGoalSchema>;

/**
 * Sprint 20 Phase 3 follow-up — per-goal achievement status. Persisted
 * in the TreatmentGoalProgress side table (keyed by treatmentPlanId +
 * goalIndex), NOT inside the versioned plan JSON. Drives the
 * "X of Y goals achieved" readout on the journey hub.
 */
export const TreatmentGoalStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED']);
export type TreatmentGoalStatus = z.infer<typeof TreatmentGoalStatusSchema>;

export const UpdateGoalProgressInputSchema = z.object({
  status: TreatmentGoalStatusSchema,
});
export type UpdateGoalProgressInput = z.infer<typeof UpdateGoalProgressInputSchema>;

export const GoalProgressSchema = z.object({
  treatmentPlanId: CuidSchema,
  goalIndex: z.number().int().nonnegative(),
  status: TreatmentGoalStatusSchema,
  updatedAt: IsoDateTimeSchema,
});
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

// ============================================================================
// Treatment plan — proposed sequence of phases + measurable goals.
// `modality` may extend beyond the SessionModality enum to include
// "supportive" / "mixed" because the AI may recommend something the
// session was not formally booked under.
// ============================================================================

export const ClinicalPlanModalitySchema = z.enum(['CBT', 'EMDR', 'supportive', 'mixed', 'other']);
export type ClinicalPlanModality = z.infer<typeof ClinicalPlanModalitySchema>;

export const ClinicalTreatmentPlanSchema = z.object({
  modality: ClinicalPlanModalitySchema,
  phaseSequence: z.array(z.string().min(1).max(120)).min(2).max(10),
  goals: z.array(ClinicalGoalSchema).min(1).max(8),
  expectedDurationSessions: z.number().int().min(1).max(60).nullable(),
});
export type ClinicalTreatmentPlan = z.infer<typeof ClinicalTreatmentPlanSchema>;

// ============================================================================
// Plan-as-diff (copilot IA redesign R3). On a FOLLOW-UP session (an active
// TreatmentPlan already exists), Pass 3 may propose specific EDITS to that
// plan instead of a whole competing plan — each a typed diff with a one-line
// rationale. Purely OPTIONAL + ADDITIVE: older reports (and any AI response
// that omits the field) default to [], and the board falls back to the full
// `treatmentPlan` flow, so there is no possible regression. The board applies
// one suggestion at a time via the plan-suggestion route → a new plan version.
// ============================================================================

export const ClinicalPlanSuggestionTypeSchema = z.enum([
  'ADD_GOAL',
  'REVISE_GOAL',
  'REMOVE_GOAL',
  'ADJUST_DURATION',
  'CHANGE_MODALITY',
]);
export type ClinicalPlanSuggestionType = z.infer<typeof ClinicalPlanSuggestionTypeSchema>;

export const ClinicalPlanSuggestionSchema = z.object({
  type: ClinicalPlanSuggestionTypeSchema,
  /** One-line clinical rationale for this edit. */
  rationale: z.string().min(1).max(500),
  /** ADD_GOAL: the new goal. REVISE_GOAL: the replacement goal. */
  goal: ClinicalGoalSchema.nullable().default(null),
  /** REVISE_GOAL / REMOVE_GOAL: index into the active plan's `goals`. */
  goalIndex: z.number().int().nonnegative().nullable().default(null),
  /** ADJUST_DURATION: the new expected session count. */
  expectedDurationSessions: z.number().int().min(1).max(60).nullable().default(null),
  /** CHANGE_MODALITY: the new modality. */
  modality: ClinicalPlanModalitySchema.nullable().default(null),
});
export type ClinicalPlanSuggestion = z.infer<typeof ClinicalPlanSuggestionSchema>;

// ============================================================================
// Recommended therapy — a named technique the AI thinks fits this
// client. Pass 4 (Sprint 14) generates an in-session script for any
// chosen name; the rationale + when-in-plan help the therapist pick.
// ============================================================================

export const ClinicalRecommendedTherapySchema = z.object({
  name: z.string().min(1).max(120),
  rationale: z.string().min(1).max(800),
  evidenceSummary: z.string().min(1).max(600),
  /**
   * Which phase of treatmentPlan.phaseSequence this therapy fits.
   * Free-text label matching one of the phaseSequence entries.
   */
  whenInPlan: z.string().min(1).max(120),
});
export type ClinicalRecommendedTherapy = z.infer<typeof ClinicalRecommendedTherapySchema>;

// ============================================================================
// Crisis flag — separate from TherapyNoteV1.riskFlags because crisis
// flagging needs structured kind + recommended action so the UI can
// drive a hard-interrupt confirmation modal with hotline numbers.
// ============================================================================

export const ClinicalCrisisKindSchema = z.enum([
  'suicidal_ideation',
  'suicidal_plan',
  'harm_to_others',
  'child_safety',
  'intimate_partner_violence',
  'psychosis',
  'substance_emergency',
  // CLIN-3 — catch-all for a crisis Gemini flags with a category outside the
  // known set. The Pass-3 normaliser coerces unknown kinds to this (preserving
  // severity + indicators) rather than failing the WHOLE report, which would
  // hide the diagnosis, formulation, AND the crisis behind a parse error.
  'other',
]);
export type ClinicalCrisisKind = z.infer<typeof ClinicalCrisisKindSchema>;

export const ClinicalCrisisSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ClinicalCrisisSeverity = z.infer<typeof ClinicalCrisisSeveritySchema>;

export const ClinicalCrisisFlagSchema = z.object({
  kind: ClinicalCrisisKindSchema,
  severity: ClinicalCrisisSeveritySchema,
  indicators: z.array(ClinicalSupportingQuoteSchema).min(1).max(8),
  recommendedAction: z.string().min(1).max(800),
});
export type ClinicalCrisisFlag = z.infer<typeof ClinicalCrisisFlagSchema>;

// ============================================================================
// ClinicalReportV1 — the full Pass 3 output. One per session.
// ============================================================================

export const ClinicalReportV1Schema = z.object({
  version: z.literal('V1'),
  /** ISO 639-1 of narrative text (formulation, gap rationales, plan goals). */
  language: ClinicalLocaleSchema.default('en'),
  modality: SessionModalitySchema,
  diagnosisCandidates: z.array(ClinicalDiagnosisCandidateSchema).min(0).max(5),
  /** Index into diagnosisCandidates, or null if the evidence is too thin. */
  primaryDiagnosisIndex: z.number().int().nonnegative().nullable(),
  assessmentGaps: z.array(ClinicalAssessmentGapSchema).max(8).default([]),
  /** 3-6 sentence case-formulation narrative. */
  formulation: z.string().min(1).max(4000),
  treatmentPlan: ClinicalTreatmentPlanSchema,
  /**
   * Plan-as-diff (R3). On a follow-up session, edits proposed to the client's
   * ACTIVE plan rather than a whole new plan. Optional + additive — empty on
   * intakes, first plans, and any response that omits it (the board then uses
   * the full `treatmentPlan` flow).
   */
  planSuggestions: z.array(ClinicalPlanSuggestionSchema).max(6).default([]),
  recommendedTherapies: z.array(ClinicalRecommendedTherapySchema).min(0).max(8),
  crisisFlags: z.array(ClinicalCrisisFlagSchema).default([]),
});
export type ClinicalReportV1 = z.infer<typeof ClinicalReportV1Schema>;

// ============================================================================
// Sprint 19 — Initial Assessment Brief.
//
// Produced by Pass 3 when SessionKind = INTAKE. Wider diagnostic
// differential, more assessment gaps, first-line therapy
// recommendations rather than next-step techniques. modality is
// nullable because intakes don't have one yet — a treatment plan
// hasn't been confirmed.
//
// Structurally similar to ClinicalReportV1 but distinct so the UI +
// downstream consumers (PreSessionBrief, competency dashboard) can
// branch on note shape.
// ============================================================================

export const InitialAssessmentBriefV1Schema = z.object({
  version: z.literal('V1'),
  language: ClinicalLocaleSchema.default('en'),
  /// Working clinical hypothesis the AI is pursuing. Mirrors the
  /// IntakeNoteV1.workingHypothesis field; surfaced here so the
  /// therapist sees what the differential is built around.
  workingHypothesis: z.string().min(1).max(4000),
  /// 0-5 differential diagnoses with citations + confidence. Same
  /// shape as ClinicalReportV1.diagnosisCandidates but typically
  /// more candidates and lower confidence per candidate. Allowed to be
  /// EMPTY: when the transcript is thin (short session, sparse
  /// disclosure) Gemini may legitimately refuse to invent a differential
  /// rather than hallucinate one — the UI surfaces the rest of the
  /// brief and the assessmentGaps that explain what's missing.
  differential: z.array(ClinicalDiagnosisCandidateSchema).max(5).default([]),
  /// Open assessment questions to ask in the next session(s) to
  /// narrow the differential.
  assessmentGaps: z.array(ClinicalAssessmentGapSchema).max(12).default([]),
  /// Case formulation in INTAKE language — provisional, no plan yet.
  formulation: z.string().min(1).max(4000),
  /// First-line therapies for the most-likely differential entry.
  /// Each ranked by evidence strength + fit for the working hypothesis.
  recommendedTherapies: z.array(ClinicalRecommendedTherapySchema).min(0).max(8),
  /// Recommended scored instruments to administer next session
  /// (PHQ-9 / GAD-7 / etc.). Names map to the InstrumentKey enum.
  recommendedInstruments: z.array(z.string().min(1).max(40)).max(6).default([]),
  /// Crisis flags surface intake-specific safety concerns even when
  /// the differential is wide open.
  crisisFlags: z.array(ClinicalCrisisFlagSchema).default([]),
});
export type InitialAssessmentBriefV1 = z.infer<typeof InitialAssessmentBriefV1Schema>;

// ============================================================================
// Section confirmation — the therapist's accept/modify/reject decision
// per section of a ClinicalReport. The whole confirmations object is
// stored on the ClinicalReport row as JSONB.
// ============================================================================

export const ClinicalSectionKeySchema = z.enum([
  'diagnosis',
  'gaps',
  'formulation',
  'plan',
  'therapies',
  'crisis',
]);
export type ClinicalSectionKey = z.infer<typeof ClinicalSectionKeySchema>;

export const ClinicalSectionStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'MODIFIED', 'REJECTED']);
export type ClinicalSectionStatus = z.infer<typeof ClinicalSectionStatusSchema>;

export const ClinicalSectionConfirmationSchema = z.object({
  status: ClinicalSectionStatusSchema,
  confirmedAt: IsoDateTimeSchema.nullable(),
  confirmedByPsychologistId: CuidSchema.nullable(),
  /** Free-text rationale, required for MODIFIED + REJECTED. */
  reason: z.string().max(2000).nullable(),
  /**
   * For MODIFIED: the therapist's edited version of the section body.
   * Opaque shape varies by section — schema is enforced by the route
   * handler against the matching section sub-schema before persist.
   */
  edits: z.unknown().nullable(),
});
export type ClinicalSectionConfirmation = z.infer<typeof ClinicalSectionConfirmationSchema>;

export const ClinicalSectionConfirmationsSchema = z.object({
  diagnosis: ClinicalSectionConfirmationSchema,
  gaps: ClinicalSectionConfirmationSchema,
  formulation: ClinicalSectionConfirmationSchema,
  plan: ClinicalSectionConfirmationSchema,
  therapies: ClinicalSectionConfirmationSchema,
  crisis: ClinicalSectionConfirmationSchema,
});
export type ClinicalSectionConfirmations = z.infer<typeof ClinicalSectionConfirmationsSchema>;

/** Default for a freshly-generated report: every section pending. */
export const PENDING_SECTION_CONFIRMATIONS: ClinicalSectionConfirmations = {
  diagnosis: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
  gaps: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
  formulation: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
  plan: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
  therapies: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
  crisis: {
    status: 'PENDING',
    confirmedAt: null,
    confirmedByPsychologistId: null,
    reason: null,
    edits: null,
  },
};

// ============================================================================
// ClinicalReport — server-side row. One per Session.
// ============================================================================

export const ClinicalReportStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export type ClinicalReportStatus = z.infer<typeof ClinicalReportStatusSchema>;

export const ClinicalReportSchema = z.object({
  id: CuidSchema,
  sessionId: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  status: ClinicalReportStatusSchema,
  body: ClinicalReportV1Schema.nullable(),
  confirmations: ClinicalSectionConfirmationsSchema,
  totalCostInr: z.string(),
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClinicalReport = z.infer<typeof ClinicalReportSchema>;

// ============================================================================
// Section-confirmation API — PATCH /api/v1/clinical-reports/[id]/sections/[section]
// ============================================================================

export const ClinicalSectionActionSchema = z.enum(['accept', 'modify', 'reject']);
export type ClinicalSectionAction = z.infer<typeof ClinicalSectionActionSchema>;

export const ConfirmClinicalSectionInputSchema = z
  .object({
    action: ClinicalSectionActionSchema,
    reason: z.string().min(1).max(2000).optional(),
    /** Per-section edited body; required for action=modify. */
    edits: z.unknown().optional(),
  })
  .refine(
    (d) => d.action !== 'modify' || d.edits !== undefined,
    'edits is required when action=modify',
  )
  .refine(
    (d) => (d.action === 'modify' || d.action === 'reject' ? d.reason !== undefined : true),
    'reason is required when action=modify or action=reject',
  );
export type ConfirmClinicalSectionInput = z.infer<typeof ConfirmClinicalSectionInputSchema>;

// ============================================================================
// Sprint TSC — copilot decision board.
// ============================================================================

/// Accept selected differential candidates from an INTAKE initial-assessment
/// brief as the client's working diagnosis. The treatment-report path goes
/// through the sections route above; intakes have no plan/section
/// confirmations, so this is the intake-shaped equivalent.
/// POST /api/v1/clinical-reports/[id]/intake-diagnosis
/// Apply ONE plan suggestion (a diff from a follow-up report) to the client's
/// active plan, producing a new plan version.
/// POST /api/v1/clinical-reports/[id]/plan-suggestion
export const AcceptPlanSuggestionInputSchema = z.object({
  /** Index into the report's `planSuggestions` array. */
  suggestionIndex: z.number().int().nonnegative(),
});
export type AcceptPlanSuggestionInput = z.infer<typeof AcceptPlanSuggestionInputSchema>;

export const AcceptIntakeDiagnosisInputSchema = z.object({
  /** Indexes into the brief's `differential` array. */
  candidateIndexes: z.array(z.number().int().nonnegative()).min(1).max(5),
  /** Which of the SELECTED candidates is primary (index into candidateIndexes). */
  primarySelectionIndex: z.number().int().nonnegative().nullable(),
  /**
   * ICD-11 codes of currently-active diagnoses (from earlier sessions, NOT in
   * this brief's differential) that the therapist chose to KEEP. Active rows
   * whose code is absent here are superseded; kept rows are left untouched. An
   * empty/absent list preserves the legacy "supersede all active" behaviour.
   */
  keepDiagnosisCodes: z.array(z.string().min(1).max(32)).max(10).optional(),
});
export type AcceptIntakeDiagnosisInput = z.infer<typeof AcceptIntakeDiagnosisInputSchema>;

/// Create treatment-plan v1 from an INTAKE brief's suggested approaches. The
/// therapist drafts a plan in the board's editor (seeded from the differential
/// + selected approaches) and saves it; this creates the first versioned
/// TreatmentPlan, mirroring the treatment-report plan-confirm write.
/// POST /api/v1/clinical-reports/[id]/intake-plan
export const AcceptIntakePlanInputSchema = z.object({
  treatmentPlan: ClinicalTreatmentPlanSchema,
});
export type AcceptIntakePlanInput = z.infer<typeof AcceptIntakePlanInputSchema>;

/// One question the therapist ticked on the decision board to carry into the
/// client's NEXT session (woven into the pre-session brief's case digest).
export const CarriedQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  rationale: z.string().max(1000).nullable(),
  sourceSessionId: z.string().nullable(),
  carriedAt: IsoDateTimeSchema,
});
export type CarriedQuestion = z.infer<typeof CarriedQuestionSchema>;

/// POST /api/v1/clients/[id]/carried-questions — replaces the list wholesale.
export const SaveCarriedQuestionsInputSchema = z.object({
  questions: z.array(CarriedQuestionSchema).max(8),
});
export type SaveCarriedQuestionsInput = z.infer<typeof SaveCarriedQuestionsInputSchema>;

// ============================================================================
// ClientDiagnosis — cumulative per-client diagnosis record. One row per
// confirmed diagnosis decision; older entries are kept (supersededAt set)
// when the therapist updates the diagnosis on a later session.
// ============================================================================

export const ClientDiagnosisSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  sessionId: CuidSchema,
  clinicalReportId: CuidSchema,
  icd11Code: Icd11CodeSchema,
  icd11Label: z.string(),
  confidence: z.number().min(0).max(1),
  supportingEvidence: z.array(ClinicalSupportingQuoteSchema),
  isPrimary: z.boolean(),
  confirmedAt: IsoDateTimeSchema,
  confirmedByPsychologistId: CuidSchema,
  supersededAt: IsoDateTimeSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientDiagnosis = z.infer<typeof ClientDiagnosisSchema>;

// ============================================================================
// TreatmentPlan — cumulative per-client plan. Versioned: each confirmation
// of a new plan bumps the version and supersedes the previous active plan.
// ============================================================================

export const TreatmentPlanSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  sourceSessionId: CuidSchema,
  sourceClinicalReportId: CuidSchema,
  version: z.number().int().positive(),
  body: ClinicalTreatmentPlanSchema,
  confirmedAt: IsoDateTimeSchema,
  confirmedByPsychologistId: CuidSchema,
  supersededAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TreatmentPlan = z.infer<typeof TreatmentPlanSchema>;

// ============================================================================
// Sprint 14 — Therapy Script (Pass 4).
//
// Pass 4 takes a recommended therapy name + the client's primary
// diagnosis + active treatment plan + last-session summary, and
// produces a step-by-step in-session script the therapist can read
// during the session. Output is cached per (client, therapy, language,
// inputs-hash) so a re-view doesn't re-bill.
//
// The Script Player UI walks the therapist through the steps; each
// step has verbatim language to say + cues for what to listen for +
// optional branches for common client responses.
// ============================================================================

export const TherapyScriptBranchSchema = z.object({
  /** Plain-language description of what the client said / showed. */
  ifClientSays: z.string().min(1).max(400),
  /** Verbatim therapist response. */
  thenDo: z.string().min(1).max(800),
});
export type TherapyScriptBranch = z.infer<typeof TherapyScriptBranchSchema>;

export const TherapyScriptStepSchema = z.object({
  /** Short stable id so the UI can persist progress. */
  id: z.string().min(1).max(64),
  /** What this step accomplishes clinically. */
  purpose: z.string().min(1).max(400),
  /** Verbatim language for the therapist to say. */
  therapistSays: z.string().min(1).max(2000),
  /** What the therapist should pay attention to in the client's response. */
  listenFor: z.string().min(1).max(800),
  /** 0-4 branches for common client responses. */
  branches: z.array(TherapyScriptBranchSchema).max(4).default([]),
});
export type TherapyScriptStep = z.infer<typeof TherapyScriptStepSchema>;

export const TherapyScriptHomeworkSchema = z.object({
  description: z.string().min(1).max(1000),
  /** Concrete instructions for delivery (when, where, how). */
  deliveryNotes: z.string().min(1).max(800),
});
export type TherapyScriptHomework = z.infer<typeof TherapyScriptHomeworkSchema>;

export const TherapyScriptV1Schema = z.object({
  version: z.literal('V1'),
  language: ClinicalLocaleSchema.default('en'),
  /** Therapy name as it appears in recommendedTherapies (or chosen from the library). */
  therapyName: z.string().min(1).max(120),
  /** Opening line(s) the therapist should say in the first 2-3 minutes. */
  openingScript: z.string().min(1).max(2000),
  /** The body of the session — ordered step list. */
  mainExercise: z.object({
    steps: z.array(TherapyScriptStepSchema).min(1).max(15),
  }),
  /** Short cues for adapting the script if the client deviates. */
  adaptationCues: z.array(z.string().min(1).max(600)).max(8).default([]),
  /** Closing line(s) for the last 3-5 minutes. */
  closingScript: z.string().min(1).max(2000),
  /** Homework / between-session assignment. */
  homework: TherapyScriptHomeworkSchema,
  /** Things to watch for that should pause the script (escalation cues). */
  riskWatchpoints: z.array(z.string().min(1).max(400)).max(8).default([]),
  /** Estimated duration in minutes — informs session pacing. */
  estimatedDurationMin: z.number().int().min(5).max(120),
});
export type TherapyScriptV1 = z.infer<typeof TherapyScriptV1Schema>;

// ============================================================================
// TherapyScript — server-side cache row. Keyed by (clientId, cacheKey)
// so re-views of the same therapy under the same context return the
// already-billed script.
// ============================================================================

export const TherapyScriptSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  therapyName: z.string(),
  language: ClinicalLocaleSchema,
  /** 64-char hex SHA-256 of normalised input tuple. */
  cacheKey: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars'),
  body: TherapyScriptV1Schema,
  /** Optional FK back to the TreatmentPlan the script was grounded against. */
  sourceTreatmentPlanId: CuidSchema.nullable(),
  /** Optional FK back to the primary ClientDiagnosis at generation time. */
  sourcePrimaryDiagnosisId: CuidSchema.nullable(),
  totalCostInr: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TherapyScript = z.infer<typeof TherapyScriptSchema>;

export const GenerateTherapyScriptQuerySchema = z.object({
  therapy: z.string().min(1).max(120),
  /** Optional override; defaults to client.preferredLanguage. */
  language: ClinicalLocaleSchema.optional(),
  /** Force a fresh generation even when a cached row exists. */
  refresh: z.coerce.boolean().optional(),
});
export type GenerateTherapyScriptQuery = z.infer<typeof GenerateTherapyScriptQuerySchema>;
