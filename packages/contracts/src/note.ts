import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { SessionModalitySchema } from './client';

// ============================================================================
// Pass 1 outputs — diarized transcript + affect features. Shipped by
// @cureocity/llm Pass 1 backends, persisted to NoteDraft, consumed by
// affect-engine-service (Sprint 4) and therapist-web (Sprint 7).
// ============================================================================

export const SpeakerSchema = z.enum(['therapist', 'client', 'unknown']);
export type Speaker = z.infer<typeof SpeakerSchema>;

/**
 * Per-segment dominant-language tag added in Sprint 16.
 *
 * Values:
 *   - An ISO 639-1 code ("en", "ml", "hi", "ta", "bn", "kn", "te", "mr", "gu", "pa")
 *     when ≥80% of the segment is a single language
 *   - "mixed" for true code-switching within the segment (Manglish,
 *     Hinglish, Tanglish, etc.)
 *   - "unknown" when language detection wasn't confident
 *
 * Optional / nullable on legacy rows that pre-date Sprint 16.
 */
export const SegmentLanguageSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2}(-[A-Z]{2})?$|^mixed$|^unknown$/);
export type SegmentLanguage = z.infer<typeof SegmentLanguageSchema>;

export const SpeakerSegmentSchema = z.object({
  speaker: SpeakerSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
  /**
   * Sprint 16: dominant language tag for this segment. Optional so
   * legacy rows that pre-date the field still validate; new Pass 1
   * runs always populate it.
   */
  language: SegmentLanguageSchema.optional(),
});
export type SpeakerSegment = z.infer<typeof SpeakerSegmentSchema>;

export const AffectFeatureSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  notes: z.string().optional(),
});
export type AffectFeature = z.infer<typeof AffectFeatureSchema>;

// ============================================================================
// Pass 2 output — TherapyNoteV1. Authoritative shape for therapy notes;
// signed notes (after clinician review) carry the same payload.
// ============================================================================

export const RiskSeveritySchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const TherapyNoteV1Schema = z.object({
  version: z.literal('V1'),
  modality: SessionModalitySchema,
  subjective: z.string().min(1),
  objective: z.string().min(1),
  assessment: z.string().min(1),
  plan: z.string().min(1),
  riskFlags: z.object({
    severity: RiskSeveritySchema,
    indicators: z.array(z.string()).default([]),
    details: z.string().optional(),
  }),
  modalitySpecific: z.record(z.unknown()).optional(),
  phaseHints: z
    .array(
      z.object({
        phase: z.string(),
        confidence: z.number().min(0).max(1),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
});

// ============================================================================
// Sprint 19 — Intake note for first sessions.
//
// Produced by Pass 2 when SessionKind = INTAKE (no prior COMPLETED
// session for this client AND no confirmed TreatmentPlan). Shape
// follows standard clinical intake conventions — history of
// presenting illness, past psychiatric history, family + social
// history, mental status exam, working hypothesis, immediate plan.
//
// Distinct from TherapyNoteV1 (SOAP) because a SOAP note assumes a
// known treatment plan; intakes are investigative and need different
// structure to be clinically useful.
// ============================================================================

export const IntakeNoteV1Schema = z.object({
  version: z.literal('V1'),
  /// Presenting concerns — what brought the client in today.
  presentingConcerns: z.string().min(1),
  /// History of present illness — onset, course, severity, triggers,
  /// alleviating factors. The "S" + most of "O" of a SOAP would
  /// merge here for an intake.
  historyOfPresentingIllness: z.string().min(1),
  /// Past psychiatric history including prior diagnoses,
  /// medications, hospitalizations, prior therapy attempts.
  pastPsychiatricHistory: z.string(),
  /// Family psychiatric / medical history relevant to the
  /// presenting picture.
  familyHistory: z.string(),
  /// Social, educational, vocational, relational context.
  socialHistory: z.string(),
  /// Mental status exam — appearance, behaviour, speech, mood,
  /// affect, thought process, thought content, perception,
  /// cognition, insight, judgement.
  mentalStatusExam: z.string().min(1),
  /// Working clinical hypothesis (NOT a confirmed diagnosis).
  /// Pass 3 produces an InitialAssessmentBrief with a differential
  /// based on this hypothesis.
  workingHypothesis: z.string().min(1),
  /// Immediate plan — what was done at the end of this intake.
  /// Usually: schedule assessment session, administer screeners,
  /// referrals.
  immediatePlan: z.string().min(1),
  riskFlags: z.object({
    severity: RiskSeveritySchema,
    indicators: z.array(z.string()).default([]),
    details: z.string().optional(),
  }),
});
export type IntakeNoteV1 = z.infer<typeof IntakeNoteV1Schema>;
export type TherapyNoteV1 = z.infer<typeof TherapyNoteV1Schema>;

// ============================================================================
// NoteDraft — server-side row representing the in-flight or completed
// generation of a note for a single Session. Sprint 2 PR 4.
// ============================================================================

export const NoteDraftStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']);
export type NoteDraftStatus = z.infer<typeof NoteDraftStatusSchema>;

export const NoteRiskSeveritySchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type NoteRiskSeverity = z.infer<typeof NoteRiskSeveritySchema>;

export const NoteDraftSchema = z.object({
  id: CuidSchema,
  sessionId: CuidSchema,
  status: NoteDraftStatusSchema,
  transcript: z.string().nullable(),
  speakerSegments: z.array(SpeakerSegmentSchema).nullable(),
  affectFeatures: z.array(AffectFeatureSchema).nullable(),
  content: TherapyNoteV1Schema.nullable(),
  riskSeverity: NoteRiskSeveritySchema.nullable(),
  totalCostInr: z.string(), // Postgres Decimal serialised as string
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type NoteDraft = z.infer<typeof NoteDraftSchema>;

// ============================================================================
// Note sign-off — therapist-web POSTs the edited note, the hash they bound
// into the WebAuthn challenge, the WebAuthn assertion, and the field-level
// edit list. Server re-hashes, verifies, and creates a TherapyNote + NoteEdit
// rows. Sprint 7 PR 4.
//
// V1 verification is hash + challenge-binding only — full WebAuthn
// signature validation against a registered credential public key lands in
// Sprint 9 when the registration flow exists. The proof is still persisted
// so it can be retro-verified once registration is in place.
// ============================================================================

export const NoteEditFieldSchema = z.enum(['subjective', 'objective', 'assessment', 'plan']);
export type NoteEditField = z.infer<typeof NoteEditFieldSchema>;

export const NoteEditEntrySchema = z.object({
  field: NoteEditFieldSchema,
  before: z.string(),
  after: z.string(),
});
export type NoteEditEntry = z.infer<typeof NoteEditEntrySchema>;

const Base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url (no padding)');

export const WebAuthnAssertionSchema = z.object({
  credentialId: Base64UrlSchema,
  clientDataJSON: Base64UrlSchema,
  authenticatorData: Base64UrlSchema,
  signature: Base64UrlSchema,
  challengeHashHex: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars'),
});
export type WebAuthnAssertion = z.infer<typeof WebAuthnAssertionSchema>;

/**
 * The payload the client built and hashed. The server re-stringifies an
 * equivalent canonical structure to verify, so this carries the trusted
 * fields: the final note text + edits + signedAt. The client's payload
 * string is also passed verbatim for hash recomputation.
 */
export const SignNoteInputSchema = z.object({
  /**
   * The exact JSON string the client SHA-256'd. Server hashes it again,
   * compares against payloadHashHex AND assertion.challengeHashHex.
   */
  payload: z
    .string()
    .min(1)
    .max(64 * 1024),
  payloadHashHex: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars'),
  note: TherapyNoteV1Schema,
  edits: z.array(NoteEditEntrySchema).default([]),
  signedAt: IsoDateTimeSchema,
  /**
   * Optional in V1 — see header comment. When present, the proof is
   * persisted on the TherapyNote row.
   */
  assertion: WebAuthnAssertionSchema.optional(),
});
export type SignNoteInput = z.infer<typeof SignNoteInputSchema>;

export const TherapyNoteSchema = z.object({
  id: CuidSchema,
  sessionId: CuidSchema,
  draftId: CuidSchema,
  version: z.literal('V1'),
  content: TherapyNoteV1Schema,
  signedAt: IsoDateTimeSchema,
  signedBy: CuidSchema,
  edits: z.array(
    z.object({
      id: CuidSchema,
      field: NoteEditFieldSchema,
      before: z.string(),
      after: z.string(),
      createdAt: IsoDateTimeSchema,
    }),
  ),
  signCredentialId: z.string().nullable(),
  signChallengeHashHex: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type TherapyNote = z.infer<typeof TherapyNoteSchema>;
