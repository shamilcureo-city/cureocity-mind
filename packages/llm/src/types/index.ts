import { z } from 'zod';
import {
  AffectFeatureSchema,
  type SessionModality,
  SpeakerSegmentSchema,
  type SpeakerSegment,
  TherapyNoteV1Schema,
} from '@cureocity/contracts';

// Re-export the cross-service schemas so existing imports from
// @cureocity/llm keep working.
export {
  SpeakerSchema,
  SpeakerSegmentSchema,
  AffectFeatureSchema,
  RiskSeveritySchema,
  TherapyNoteV1Schema,
} from '@cureocity/contracts';
export type {
  Speaker,
  SpeakerSegment,
  AffectFeature,
  RiskSeverity,
  TherapyNoteV1,
} from '@cureocity/contracts';

// ============================================================================
// Pass 1: Transcribe + analyse. Audio → transcript + speaker segments + affect.
// Runs in asia-south1 (Gemini 1.5 Flash) — keeps raw audio inside India for
// DPDP residency. See execution plan § 6.1.
// ============================================================================

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

export interface Pass2Input {
  sessionId: string;
  transcript: string;
  speakerSegments: SpeakerSegment[];
  modality: SessionModality;
  clientContext: {
    presentingConcerns?: string;
    preferredModality?: SessionModality;
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
