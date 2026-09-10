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
  operationId: z.string().uuid().optional(),
});
export type CreateAgreementInput = z.infer<typeof CreateAgreementInputSchema>;

/// PATCH /api/v1/sessions/[id]/agreements/[agreementId] — next-session
/// follow-up marking (from the Prepare card).
export const UpdateAgreementInputSchema = z.object({
  followUp: AgreementFollowUpSchema,
  /** Older uncorrected records may omit this; corrected records require a matching revision. */
  expectedRevision: z.number().int().min(0).optional(),
});
export type UpdateAgreementInput = z.infer<typeof UpdateAgreementInputSchema>;

export const AgreementCorrectionInputSchema = z
  .object({
    operation: z.enum(['correct', 'amend']),
    operationId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    text: z.string().trim().min(1).max(500),
    speaker: AgreementSpeakerSchema,
    reason: z.enum(['CORRECTION', 'ATTRIBUTION', 'CLARIFICATION']),
  })
  .strict();

export const AgreementRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    operationId: z.string().uuid(),
    operation: z.enum(['correct', 'amend']),
    reason: z.enum(['CORRECTION', 'ATTRIBUTION', 'CLARIFICATION']),
    previousText: z.string().min(1).max(500),
    previousSpeaker: AgreementSpeakerSchema,
    previousFollowUp: AgreementFollowUpSchema.nullable(),
    previousFollowUpAt: z.string().datetime().nullable(),
    previousRetiredAt: z.string().datetime().nullable().optional(),
    previousRetirementReason: z.string().nullable().optional(),
    text: z.string().min(1).max(500),
    speaker: AgreementSpeakerSchema,
    recordedAt: z.string().datetime(),
    recordedBy: z.string(),
    signedNoteId: z.string().nullable(),
  })
  .strict();
export const AgreementRevisionHistorySchema = z.array(AgreementRevisionSchema).max(100);
export type AgreementRevision = z.infer<typeof AgreementRevisionSchema>;

export const RetireAgreementInputSchema = z
  .object({
    operation: z.literal('retire'),
    expectedRevision: z.number().int().min(0),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const SessionAgreementDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  clientId: z.string().optional(),
  sourceSessionAt: z.string().optional(),
  text: z.string(),
  speaker: AgreementSpeakerSchema,
  followUp: AgreementFollowUpSchema.nullable(),
  createdAt: z.string(),
  revision: z.number().int().min(0).optional(),
  revisions: AgreementRevisionHistorySchema.optional(),
  retiredAt: z.string().nullable().optional(),
  retirementReason: z.string().nullable().optional(),
  canUseAsHomework: z.boolean().optional(),
  homeworkAssignments: z
    .array(
      z.object({
        id: z.string(),
        sourceAgreementRevision: z.number().int().min(0),
        customDescription: z.string().nullable(),
        dueAt: z.string().nullable(),
        status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'EXPIRED']),
      }),
    )
    .optional(),
});
export type SessionAgreementDto = z.infer<typeof SessionAgreementDtoSchema>;

export const ActiveAgreementQuerySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
});
export const ActiveAgreementPageSchema = z.object({
  agreements: z.array(SessionAgreementDtoSchema).max(20),
  total: z.number().int().min(0),
  nextCursor: z.string().nullable(),
});

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
