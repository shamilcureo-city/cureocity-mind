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

export const SpeakerSegmentSchema = z.object({
  speaker: SpeakerSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
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
