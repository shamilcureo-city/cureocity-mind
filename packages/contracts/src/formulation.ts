import { z } from 'zod';

/**
 * The Session Loop (SL1) — the living case formulation.
 *
 * Therapy's centre of gravity is not the diagnosis list — it is the case
 * formulation: why the suffering persists (the maintaining cycle), what
 * shaped it (the five Ps), and what treatment predicts. This contract makes
 * the formulation a first-class, VERSIONED object (like TreatmentPlan):
 * the AI proposes evidence-anchored updates, the therapist authors freely,
 * and every confirmed change produces a new version.
 */

// ---------------------------------------------------------------------------
// The maintaining cycle — a small ordered chain of nodes. `breaking` marks
// the link treatment is currently aimed at (rendered dashed-green).
// ---------------------------------------------------------------------------

export const CycleRoleSchema = z.enum([
  'TRIGGER',
  'THOUGHT',
  'FEELING',
  'BEHAVIOUR',
  'CONSEQUENCE',
]);
export type CycleRole = z.infer<typeof CycleRoleSchema>;

export const CycleNodeSchema = z.object({
  role: CycleRoleSchema,
  text: z.string().min(1).max(300),
  /// True on the link treatment is actively breaking.
  breaking: z.boolean().default(false),
});
export type CycleNode = z.infer<typeof CycleNodeSchema>;

export const FormulationPredictionSchema = z.object({
  text: z.string().min(1).max(400),
  status: z.enum(['HOLDING', 'TO_TEST', 'NOT_MATCHING']),
});
export type FormulationPrediction = z.infer<typeof FormulationPredictionSchema>;

export const CaseFormulationV1Schema = z.object({
  version: z.literal('V1'),
  /// The one-paragraph clinical narrative (the classic formulation prose).
  narrative: z.string().max(3000).default(''),
  cycle: z.array(CycleNodeSchema).max(8).default([]),
  fivePs: z
    .object({
      predisposing: z.array(z.string().min(1).max(300)).max(8).default([]),
      precipitating: z.array(z.string().min(1).max(300)).max(8).default([]),
      perpetuating: z.array(z.string().min(1).max(300)).max(8).default([]),
      protective: z.array(z.string().min(1).max(300)).max(8).default([]),
    })
    .default({ predisposing: [], precipitating: [], perpetuating: [], protective: [] }),
  predictions: z.array(FormulationPredictionSchema).max(6).default([]),
});
export type CaseFormulationV1 = z.infer<typeof CaseFormulationV1Schema>;

// ---------------------------------------------------------------------------
// AI-proposed formulation updates (Pass 3, OPTIONAL + additive — the same
// zero-regression pattern as planSuggestions). Each is one evidence-anchored
// edit the therapist can accept; a dropped/unappliable suggestion never
// sinks the report.
// ---------------------------------------------------------------------------

export const FormulationTargetSchema = z.enum([
  'NARRATIVE',
  'CYCLE',
  'PREDISPOSING',
  'PRECIPITATING',
  'PERPETUATING',
  'PROTECTIVE',
  'PREDICTION',
]);
export type FormulationTarget = z.infer<typeof FormulationTargetSchema>;

export const FormulationSuggestionSchema = z.object({
  target: FormulationTargetSchema,
  action: z.enum(['ADD', 'REVISE']),
  text: z.string().min(1).max(600),
  /// Verbatim transcript quote grounding the suggestion (may be null on
  /// history-derived updates).
  evidenceQuote: z.string().max(500).nullable().default(null),
  /// Only meaningful for target CYCLE + action ADD.
  cycleRole: CycleRoleSchema.nullable().default(null),
});
export type FormulationSuggestion = z.infer<typeof FormulationSuggestionSchema>;

// ---------------------------------------------------------------------------
// Route inputs.
// ---------------------------------------------------------------------------

/// POST /api/v1/clients/[id]/formulation — accept ONE AI suggestion into a
/// new formulation version, or author the whole formulation directly.
export const SaveFormulationInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    reportId: z.string().min(1),
    suggestionIndex: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('author'),
    formulation: CaseFormulationV1Schema,
  }),
]);
export type SaveFormulationInput = z.infer<typeof SaveFormulationInputSchema>;

// ---------------------------------------------------------------------------
// Session agreements — "what we agreed", in the client's words where
// possible. The client-facing contract the session produces; next session's
// Prepare card reads these back with a follow-up status.
// ---------------------------------------------------------------------------

export const AgreementSpeakerSchema = z.enum(['CLIENT', 'THERAPIST']);
export type AgreementSpeaker = z.infer<typeof AgreementSpeakerSchema>;

export const AgreementFollowUpSchema = z.enum(['DONE', 'PARTLY', 'NOT_YET']);
export type AgreementFollowUp = z.infer<typeof AgreementFollowUpSchema>;

export const CreateAgreementInputSchema = z.object({
  text: z.string().min(1).max(500),
  speaker: AgreementSpeakerSchema,
});
export type CreateAgreementInput = z.infer<typeof CreateAgreementInputSchema>;

/// PATCH /api/v1/sessions/[id]/agreements/[agreementId] — next-session
/// follow-up marking (from the Prepare card).
export const UpdateAgreementInputSchema = z.object({
  followUp: AgreementFollowUpSchema,
});
export type UpdateAgreementInput = z.infer<typeof UpdateAgreementInputSchema>;

export const SessionAgreementDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  text: z.string(),
  speaker: AgreementSpeakerSchema,
  followUp: AgreementFollowUpSchema.nullable(),
  createdAt: z.string(),
});
export type SessionAgreementDto = z.infer<typeof SessionAgreementDtoSchema>;

// ---------------------------------------------------------------------------
// Session feedback — one-tap alliance read ("how did the session land?").
// Catches drift before the scores do.
// ---------------------------------------------------------------------------

export const AllianceRatingSchema = z.enum(['ROUGH', 'FLAT', 'GOOD', 'STRONG']);
export type AllianceRating = z.infer<typeof AllianceRatingSchema>;

export const SessionFeedbackInputSchema = z.object({
  alliance: AllianceRatingSchema,
});
export type SessionFeedbackInput = z.infer<typeof SessionFeedbackInputSchema>;
