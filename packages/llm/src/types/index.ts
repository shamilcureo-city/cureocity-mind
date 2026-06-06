import { z } from 'zod';
import {
  AffectFeatureSchema,
  type ClinicalLocale,
  ClinicalReportV1Schema,
  type ClientDiagnosis,
  type SessionModality,
  SpeakerSegmentSchema,
  type SpeakerSegment,
  TherapyNoteV1Schema,
  type TherapyNoteV1,
  type TreatmentPlan,
} from '@cureocity/contracts';

// Re-export the cross-service schemas so existing imports from
// @cureocity/llm keep working.
export {
  SpeakerSchema,
  SpeakerSegmentSchema,
  AffectFeatureSchema,
  RiskSeveritySchema,
  TherapyNoteV1Schema,
  ClinicalReportV1Schema,
} from '@cureocity/contracts';
export type {
  Speaker,
  SpeakerSegment,
  AffectFeature,
  RiskSeverity,
  TherapyNoteV1,
  ClinicalReportV1,
  ClinicalLocale,
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
// Pass 3: Transcript + TherapyNote + history → ClinicalReportV1. Sprint 13.
// Runs in the global Pro region (no audio, transcript text only — same
// cross-border-consent surface as Pass 2).
// ============================================================================

export interface Pass3PriorDiagnosis {
  icd11Code: string;
  icd11Label: string;
  confidence: number;
  isPrimary: boolean;
  confirmedAt: string;
}

export interface Pass3PriorTreatmentPlan {
  modality: string;
  phaseSequence: string[];
  goals: { description: string; measure: string }[];
  expectedDurationSessions: number | null;
  version: number;
  confirmedAt: string;
}

export interface Pass3Input {
  sessionId: string;
  transcript: string;
  speakerSegments: SpeakerSegment[];
  modality: SessionModality;
  /** Per-session output language hint. */
  language: ClinicalLocale;
  /** The TherapyNoteV1 already produced by Pass 2 for this session. */
  note: TherapyNoteV1;
  clientContext: {
    presentingConcerns?: string;
    priorDiagnoses?: Pass3PriorDiagnosis[];
    priorTreatmentPlan?: Pass3PriorTreatmentPlan | null;
  };
}

export const Pass3OutputSchema = z.object({
  clinicalReport: ClinicalReportV1Schema,
});
export type Pass3Output = z.infer<typeof Pass3OutputSchema>;

// ============================================================================
// Call log — what each backend reports back, persisted by the router.
// ============================================================================

export type GeminiPass =
  | 'PASS_1_TRANSCRIBE_AND_ANALYSE'
  | 'PASS_2_NOTE_GENERATION'
  | 'PASS_3_CLINICAL_ANALYSIS'
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

export interface IPass3Backend {
  run(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }>;
}

export interface IModelRouter {
  pass1(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }>;
  pass2(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }>;
  pass3(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }>;
}

// Re-export DTOs that consumers of @cureocity/llm need but don't yet
// pull from @cureocity/contracts directly.
export type { ClientDiagnosis, TreatmentPlan };
