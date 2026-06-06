import { z } from 'zod';
import {
  AffectFeatureSchema,
  type ClinicalLocale,
  ClinicalReportV1Schema,
  type ClientDiagnosis,
  PreSessionBriefV1Schema,
  type SessionModality,
  SpeakerSegmentSchema,
  type SpeakerSegment,
  TherapyNoteV1Schema,
  type TherapyNoteV1,
  TherapyScriptV1Schema,
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
  TherapyScriptV1Schema,
  PreSessionBriefV1Schema,
} from '@cureocity/contracts';
export type {
  Speaker,
  SpeakerSegment,
  AffectFeature,
  RiskSeverity,
  TherapyNoteV1,
  ClinicalReportV1,
  ClinicalLocale,
  TherapyScriptV1,
  PreSessionBriefV1,
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
  /**
   * Sprint 16 — language detection. ISO 639-1 codes (or "mixed") of
   * the languages Pass 1 detected in the audio, sorted by prevalence.
   * Empty for legacy runs that pre-date the field.
   *
   * Examples:
   *   ["en"] — English-only session
   *   ["ml", "en"] — Manglish, mostly Malayalam
   *   ["hi", "en"] — Hinglish, mostly Hindi
   *   ["en", "ml"] — primarily English with Malayalam interjections
   */
  detectedLanguages: z.array(z.string().min(2).max(16)).default([]),
});
export type Pass1Output = z.infer<typeof Pass1OutputSchema>;

export interface Pass1Input {
  sessionId: string;
  /** Concatenated PCM audio (16 kHz mono signed 16-bit LE) for the full session. */
  audioBytes: Buffer;
  /** Total duration of the audio, in milliseconds — used for cost estimation. */
  durationMs: number;
  /**
   * Optional clinical context to bias diarization + language
   * detection. Sprint 16: spokenLanguageHints is the client's
   * known spoken languages (set by the therapist when creating the
   * client) so the model leans into those when the audio is
   * ambiguous.
   */
  hints?: {
    therapistFullName?: string;
    spokenLanguageHints?: string[];
  };
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
// Pass 4: Therapy name + diagnosis + plan + summary → TherapyScriptV1.
// Sprint 14. Same global Pro region as Pass 2/3.
// ============================================================================

export interface Pass4PriorPlanSummary {
  modality: string;
  phaseSequence: string[];
  goals: { description: string; measure: string }[];
  expectedDurationSessions: number | null;
}

export interface Pass4Input {
  therapyName: string;
  /**
   * Output language for narrative therapist-facing text (purpose,
   * listenFor, adaptationCues, riskWatchpoints, homework
   * deliveryNotes). Default "en". The therapist reads these
   * silently — pick whatever they prefer to read.
   */
  language: ClinicalLocale;
  /**
   * Sprint 16 — verbatim "therapistSays" + branches.thenDo language.
   * The therapist reads these ALOUD to the client, so the language
   * must match what the client speaks/understands.
   *
   * Defaults to `language` (output language) on the route layer when
   * the client has no spokenLanguages on file. If the client speaks
   * code-mixed (e.g. Manglish), use the dominant base language and
   * include English clinical terms inline — the prompt explains
   * this convention.
   */
  spokenLanguage?: ClinicalLocale;
  /** Optional context. Empty fields are rendered as "(none)" in the prompt. */
  primaryDiagnosis?: { icd11Code: string; icd11Label: string };
  treatmentPlan?: Pass4PriorPlanSummary;
  lastSessionSummary?: string;
  presentingConcerns?: string;
  /**
   * Optional cache-affecting fields. Not consumed by the prompt but
   * included in the cache-key hash so unrelated session context
   * doesn't poison the cache. The route layer computes this.
   */
  cacheKeyTrace?: string;
}

export const Pass4OutputSchema = z.object({
  therapyScript: TherapyScriptV1Schema,
});
export type Pass4Output = z.infer<typeof Pass4OutputSchema>;

// ============================================================================
// Pass 5: pre-session brief. Sprint 17.
// Reads the client's cumulative confirmed clinical record + most
// recent therapy script + last-session note + instrument scores +
// open crisis flags, and produces a one-screen brief the therapist
// reads before opening the session.
// ============================================================================

export interface Pass5InstrumentSnapshot {
  instrumentKey: string;
  score: number;
  severity: string;
  administeredAt: string;
}

export interface Pass5CrisisCarryover {
  kind: string;
  severity: 'high' | 'critical';
  lastSeenAt: string;
}

export interface Pass5Input {
  clientId: string;
  language: ClinicalLocale;
  /** Used in the contextLine ("Session 4 of 8 · CBT for panic disorder."). */
  sessionNumber?: number;
  /** Primary diagnosis label, if confirmed. */
  primaryDiagnosis?: { icd11Code: string; icd11Label: string };
  /** Active confirmed treatment plan summary. */
  treatmentPlan?: {
    modality: string;
    phaseSequence: string[];
    goals: { description: string; measure: string }[];
    expectedDurationSessions: number | null;
    sessionsSoFar?: number;
  };
  /** Last-session SOAP highlights. Empty for first sessions. */
  lastSessionSummary?: string;
  /** Last session's homework, if any was assigned. */
  lastHomework?: { description: string; outcome: string | null };
  /** Most recent therapy-script name + when. */
  lastTherapyScript?: { therapyName: string; viewedAt: string };
  /** Carryover crisis flags from prior sessions. */
  openCrises?: Pass5CrisisCarryover[];
  /** Latest scored instrument readings. */
  latestInstruments?: Pass5InstrumentSnapshot[];
  /** Free-text presenting concerns. */
  presentingConcerns?: string;
}

export const Pass5OutputSchema = z.object({
  preSessionBrief: PreSessionBriefV1Schema,
});
export type Pass5Output = z.infer<typeof Pass5OutputSchema>;

// ============================================================================
// Call log — what each backend reports back, persisted by the router.
// ============================================================================

export type GeminiPass =
  | 'PASS_1_TRANSCRIBE_AND_ANALYSE'
  | 'PASS_2_NOTE_GENERATION'
  | 'PASS_3_CLINICAL_ANALYSIS'
  | 'PASS_3_MISSED_THEMES'
  | 'PASS_4_THERAPY_SCRIPT'
  | 'PASS_5_PRE_SESSION_BRIEF';

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

export interface IPass4Backend {
  run(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }>;
}

export interface IPass5Backend {
  run(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }>;
}

export interface IModelRouter {
  pass1(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }>;
  pass2(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }>;
  pass3(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }>;
  pass4(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }>;
  pass5(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }>;
}

// Re-export DTOs that consumers of @cureocity/llm need but don't yet
// pull from @cureocity/contracts directly.
export type { ClientDiagnosis, TreatmentPlan };
