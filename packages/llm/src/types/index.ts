import { z } from 'zod';
import { SessionModalitySchema } from '@cureocity/contracts';

// ============================================================================
// Pass 1: Transcribe + analyse. Audio → transcript + speaker segments + affect.
// Runs in asia-south1 (Gemini 1.5 Flash) — keeps raw audio inside India for
// DPDP residency. See execution plan § 6.1.
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

export const Pass1OutputSchema = z.object({
  transcript: z.string(),
  speakerSegments: z.array(SpeakerSegmentSchema),
  affectFeatures: z.array(AffectFeatureSchema),
});
export type Pass1Output = z.infer<typeof Pass1OutputSchema>;

export interface Pass1Input {
  sessionId: string;
  /** Concatenated PCM audio (16 kHz mono signed 16-bit LE) for the full session. */
  audioBytes: Buffer;
  /** Total duration of the audio, in milliseconds — used for cost estimation. */
  durationMs: number;
  /** Optional clinical context to bias diarization (e.g. therapist name). */
  hints?: { therapistFullName?: string };
}

// ============================================================================
// Pass 2: Transcript → TherapyNoteV1. Runs in global Pro region (no audio,
// only de-identified transcript text — cross-border consent required).
// ============================================================================

export const RiskSeveritySchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const TherapyNoteV1Schema = z.object({
  version: z.literal('V1'),
  modality: SessionModalitySchema,
  /** SOAP-ish — clinician can edit before signing. */
  subjective: z.string().min(1),
  objective: z.string().min(1),
  assessment: z.string().min(1),
  plan: z.string().min(1),
  /** Risk flags drive crisis escalation (gap G3). */
  riskFlags: z.object({
    severity: RiskSeveritySchema,
    indicators: z.array(z.string()).default([]),
    details: z.string().optional(),
  }),
  /** Modality-specific structured output (CBT thought records, EMDR SUDS, etc.). */
  modalitySpecific: z.record(z.unknown()).optional(),
  /** Phase progression hints consumed by modality-workflow-service (Sprint 3). */
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

export interface Pass2Input {
  sessionId: string;
  transcript: string;
  speakerSegments: SpeakerSegment[];
  modality: z.infer<typeof SessionModalitySchema>;
  clientContext: {
    presentingConcerns?: string;
    preferredModality?: z.infer<typeof SessionModalitySchema>;
  };
}

export const Pass2OutputSchema = z.object({
  therapyNote: TherapyNoteV1Schema,
});
export type Pass2Output = z.infer<typeof Pass2OutputSchema>;

// ============================================================================
// Call log — what each backend reports back, persisted by the router.
// ============================================================================

export type GeminiPass =
  | 'PASS_1_TRANSCRIBE_AND_ANALYSE'
  | 'PASS_2_NOTE_GENERATION'
  | 'PASS_3_MISSED_THEMES';

export type GeminiCallStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CIRCUIT_OPEN';

export interface GeminiCallLogData {
  sessionId: string | null;
  pass: GeminiPass;
  model: string;
  region: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  /** Decimal INR with up to 4 fractional digits. */
  costInr: number;
  latencyMs: number;
  status: GeminiCallStatus;
  errorMessage?: string;
}

// ============================================================================
// Backend interfaces
// ============================================================================

export interface IPass1Backend {
  run(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }>;
}

export interface IPass2Backend {
  run(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }>;
}

export interface IModelRouter {
  pass1(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }>;
  pass2(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }>;
}
