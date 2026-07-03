import { z } from 'zod';
import {
  AffectFeatureSchema,
  CaseBriefingV1Schema,
  CaseConsultV1Schema,
  type CaseState,
  ClinicalFindingSchema,
  type ClinicalLocale,
  ClinicalReportV1Schema,
  AskNextItemSchema,
  LiveDifferentialItemSchema,
  type LiveDifferentialItem,
  LiveRedFlagSchema,
  type Utterance,
  type ClientDiagnosis,
  ConceptualMapV1Schema,
  ClinicalOrderV1Schema,
  DifferentialDiagnosisV1Schema,
  InitialAssessmentBriefV1Schema,
  IntakeNoteV1Schema,
  type IntakeNoteV1,
  MedicalEncounterNoteV1Schema,
  type MedicalEncounterNoteV1,
  MedicationOrderV1Schema,
  PreSessionBriefV1Schema,
  type SessionKind,
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
  IntakeNoteV1Schema,
  InitialAssessmentBriefV1Schema,
  SessionKindSchema,
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
  IntakeNoteV1,
  InitialAssessmentBriefV1,
  SessionKind,
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
  /**
   * Sprint 19 — session classification. Drives the prompt branch:
   *   TREATMENT / REVIEW → produces TherapyNoteV1 (SOAP)
   *   INTAKE             → produces IntakeNoteV1 (history + MSE + working hypothesis)
   * Treatment notes assume a known plan; intakes are investigative
   * and need a different shape to be clinically useful.
   */
  kind: SessionKind;
  /**
   * Sprint 19 — modality may be null for INTAKE sessions. For
   * TREATMENT / REVIEW, the orchestrator should have a non-null
   * value from the session-defaults cascade.
   */
  modality: SessionModality | null;
  /**
   * Sprint DV3 — practitioner vertical. DOCTOR routes Pass 2 to the
   * medical encounter note (MedicalEncounterNoteV1, the MEDICAL output
   * arm); THERAPIST (default / omitted) uses the kind-based therapy
   * branch above. See docs/DOCTOR_VERTICAL.md.
   */
  vertical?: 'THERAPIST' | 'DOCTOR';
  clientContext: {
    presentingConcerns?: string;
    preferredModality?: SessionModality;
  };
  /**
   * Sprint 70 — the note template chosen for this session. When present, the
   * backend additionally produces `templateSections` (title + body) shaped to
   * these section titles, alongside the standard SOAP fields. Omitted → the
   * built-in SOAP structure only.
   */
  template?: {
    name: string;
    sections: { title: string; hint?: string }[];
  };
}

/**
 * Sprint 19 — discriminated union. Treatment / review sessions
 * produce a SOAP TherapyNoteV1; intakes produce an IntakeNoteV1.
 * Callers MUST branch on `output.kind` before reading the body.
 */
export const Pass2OutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TREATMENT'),
    therapyNote: TherapyNoteV1Schema,
  }),
  z.object({
    kind: z.literal('REVIEW'),
    therapyNote: TherapyNoteV1Schema,
  }),
  z.object({
    kind: z.literal('INTAKE'),
    intakeNote: IntakeNoteV1Schema,
  }),
  // Sprint DV3 — doctor vertical. A medical encounter note instead of a
  // therapy note; selected when Pass2Input.vertical === 'DOCTOR'.
  // Sprint DV5 — the same pass also drafts the Rx + clinical orders the
  // finalizer persists (medications[] / orders[]); both default to empty
  // so older callers / non-prescribing encounters stay valid.
  z.object({
    kind: z.literal('MEDICAL'),
    encounterNote: MedicalEncounterNoteV1Schema,
    medications: z.array(MedicationOrderV1Schema).default([]),
    orders: z.array(ClinicalOrderV1Schema).default([]),
  }),
]);
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
  /** Sprint 19 — session classification. Same value as Pass2Input.kind. */
  kind: SessionKind;
  /** Sprint 19 — nullable for INTAKE sessions. */
  modality: SessionModality | null;
  /** Per-session output language hint. */
  language: ClinicalLocale;
  /**
   * Sprint 19 — Pass 2 output. Discriminated by kind:
   *   TREATMENT / REVIEW → TherapyNoteV1
   *   INTAKE             → IntakeNoteV1
   * Pass 3 prompt picks the right context shape.
   */
  note: TherapyNoteV1 | IntakeNoteV1;
  clientContext: {
    presentingConcerns?: string;
    priorDiagnoses?: Pass3PriorDiagnosis[];
    priorTreatmentPlan?: Pass3PriorTreatmentPlan | null;
  };
}

/**
 * Sprint 19 — discriminated union. Treatment / review sessions
 * produce a ClinicalReportV1 (diagnosis candidates + plan + crisis);
 * intakes produce an InitialAssessmentBriefV1 (working hypothesis +
 * wider differential + recommended instruments). Callers MUST
 * branch on `output.kind` before reading the body.
 */
export const Pass3OutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TREATMENT'),
    clinicalReport: ClinicalReportV1Schema,
  }),
  z.object({
    kind: z.literal('REVIEW'),
    clinicalReport: ClinicalReportV1Schema,
  }),
  z.object({
    kind: z.literal('INTAKE'),
    initialAssessmentBrief: InitialAssessmentBriefV1Schema,
  }),
]);
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
// Pass 6 — Case Briefing (Sprint 22). A per-client synthesis: 5 Ps
// formulation, open assessment items, next 1-3 actions, cadence. The
// input is a compact serialisation of the whole cumulative record for
// ONE client; the deterministic builder in apps/web is the fallback.
// ============================================================================

export interface Pass6Input {
  clientId: string;
  language: ClinicalLocale;
  /** Pre-serialised cumulative record (the route builds this text blob). */
  contextText: string;
  /** The deterministic briefing as a JSON string — the LLM refines it. */
  deterministicBriefingJson: string;
}

export const Pass6OutputSchema = z.object({
  caseBriefing: CaseBriefingV1Schema,
});
export type Pass6Output = z.infer<typeof Pass6OutputSchema>;

// ============================================================================
// Pass 7 — Conceptual Map (Sprint 24).
// ============================================================================

export interface Pass7Input {
  clientId: string;
  language: ClinicalLocale;
  /** Pre-serialised cumulative record (the route builds this text blob). */
  contextText: string;
  /** Session IDs the contextText draws from. */
  basedOnSessionIds: string[];
}

export const Pass7OutputSchema = z.object({
  conceptualMap: ConceptualMapV1Schema,
});
export type Pass7Output = z.infer<typeof Pass7OutputSchema>;

// ============================================================================
// Pass 8 — Case Consult (Sprint 52). Structured second opinion for a
// stuck case. Reuses the case-briefing context assembler so the input
// shape is mostly a pre-serialised context blob; the journeySignalsJson
// gives the model the deterministic outputs (verdicts, next-best-action,
// adherence) so it never has to re-derive them.
// ============================================================================

export interface Pass8Input {
  clientId: string;
  language: ClinicalLocale;
  /** Pre-serialised cumulative record (same shape Pass 6 + 7 already use). */
  contextText: string;
  /** Deterministic journey signals + reliable-change verdicts as JSON. */
  journeySignalsJson: string;
}

export const Pass8OutputSchema = z.object({
  caseConsult: CaseConsultV1Schema,
});
export type Pass8Output = z.infer<typeof Pass8OutputSchema>;

// ============================================================================
// Differential pass — Sprint DV6 (doctor vertical). The medical analogue of
// Pass 3: encounter note + transcript → DifferentialDiagnosisV1 (ranked
// candidates with ICD-10, discriminating questions, suggested workup) +
// ICD-10 coding nudges. Run on-demand / via after() like Pass 3.
// Gemini Pro (global) — transcript text only, same cross-border surface.
// ============================================================================

export interface PassDifferentialInput {
  sessionId: string;
  transcript: string;
  speakerSegments: SpeakerSegment[];
  /** The drafted medical encounter note (the MEDICAL Pass-2 arm). */
  encounterNote: MedicalEncounterNoteV1;
  /** The doctor's specialty, biases the differential + coding. */
  specialty?: string;
  /** Output language hint. */
  language: ClinicalLocale;
}

export const PassDifferentialOutputSchema = z.object({
  differential: DifferentialDiagnosisV1Schema,
});
export type PassDifferentialOutput = z.infer<typeof PassDifferentialOutputSchema>;

// ============================================================================
// Sprint DS1 — PassFindings. The live reasoning substrate's first micro-pass:
// turn new transcript utterances (given the running CaseState) into
// structured clinical findings that the differential (DS2) + ask-next (DS3)
// engines cite by id. Flash, structured output, temp 0. The gateway runs it
// per window; the citation gate lives in the gateway (drops findings citing
// utterance ids that don't exist). See docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS1.
// ============================================================================
export interface PassFindingsInput {
  sessionId: string;
  /** The running case state (patient context + findings so far). */
  caseState: CaseState;
  /** Only the utterances added since the last pass — incremental by design. */
  newUtterances: Utterance[];
  /** Doctor specialty, biases what's clinically salient. */
  specialty?: string;
  /** Output language hint. */
  language?: ClinicalLocale;
}

export const PassFindingsOutputSchema = z.object({
  /** New/updated findings (stable ids; same id replaces, new id appends). */
  findings: z.array(ClinicalFindingSchema),
  /** Ids of open ask-next questions the extractor saw answered on-mic. */
  answeredQuestionIds: z.array(z.string()).default([]),
});
export type PassFindingsOutput = z.infer<typeof PassFindingsOutputSchema>;

// ============================================================================
// Sprint DS2 — PassReasoning. THE core: ONE combined Flash call per cycle
// that produces findings-δ + the ranked differential + ask-next questions +
// red flags. DS1's PassFindings is folded in as this pass's first section
// (one call is cheaper + more coherent than two). Input is the running
// CaseState + the previous differential (for stable ids + trend) + the new
// utterances — incremental, never the whole consult. Flash, structured
// output, temp 0. Every dx/red-flag must cite finding ids; the gateway
// post-validates + drops uncited items. See DOCTOR_SCRIBE_V2_SPRINTS.md DS2.
// ============================================================================
export interface PassReasoningInput {
  sessionId: string;
  /** The running case state (patient context + findings so far). */
  caseState: CaseState;
  /** The previous differential — so the model preserves ids + sets trend. */
  previousDifferential: LiveDifferentialItem[];
  /**
   * Sprint DS3 — the currently-open ask-next questions, so the model doesn't
   * repeat them and can report which the new utterances answered.
   */
  openQuestions?: { id: string; question: string }[];
  /** Only the utterances added since the last pass — incremental. */
  newUtterances: Utterance[];
  specialty?: string;
  language?: ClinicalLocale;
}

export const PassReasoningOutputSchema = z.object({
  /** Findings-δ (stable ids; same id replaces, new id appends). */
  findings: z.array(ClinicalFindingSchema).default([]),
  /** Open ask-next question ids these utterances answered. */
  answeredQuestionIds: z.array(z.string()).default([]),
  /** Ranked candidates (gateway caps at 5 + drops uncited). */
  differential: z.array(LiveDifferentialItemSchema).default([]),
  /** Differential-driven missing questions (DS3 adds template-driven ones). */
  askNext: z.array(AskNextItemSchema).default([]),
  /** Serious conditions to actively exclude. */
  redFlags: z.array(LiveRedFlagSchema).default([]),
});
export type PassReasoningOutput = z.infer<typeof PassReasoningOutputSchema>;

// ============================================================================
// Call log — what each backend reports back, persisted by the router.
// ============================================================================

export type GeminiPass =
  | 'PASS_1_TRANSCRIBE_AND_ANALYSE'
  | 'PASS_2_NOTE_GENERATION'
  | 'PASS_3_CLINICAL_ANALYSIS'
  | 'PASS_3_MISSED_THEMES'
  | 'PASS_4_THERAPY_SCRIPT'
  | 'PASS_5_PRE_SESSION_BRIEF'
  | 'PASS_6_CASE_BRIEFING'
  | 'PASS_7_CONCEPTUAL_MAP'
  | 'PASS_8_CASE_CONSULT'
  | 'PASS_9_DIFFERENTIAL'
  | 'PASS_10_FINDINGS'
  | 'PASS_11_REASONING';

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

export interface IPass6Backend {
  run(input: Pass6Input): Promise<{ output: Pass6Output; callLog: GeminiCallLogData }>;
}

export interface IPass7Backend {
  run(input: Pass7Input): Promise<{ output: Pass7Output; callLog: GeminiCallLogData }>;
}

export interface IPass8Backend {
  run(input: Pass8Input): Promise<{ output: Pass8Output; callLog: GeminiCallLogData }>;
}

export interface IPassDifferentialBackend {
  run(
    input: PassDifferentialInput,
  ): Promise<{ output: PassDifferentialOutput; callLog: GeminiCallLogData }>;
}

export interface IPassFindingsBackend {
  run(
    input: PassFindingsInput,
  ): Promise<{ output: PassFindingsOutput; callLog: GeminiCallLogData }>;
}

export interface IPassReasoningBackend {
  run(
    input: PassReasoningInput,
  ): Promise<{ output: PassReasoningOutput; callLog: GeminiCallLogData }>;
}

export interface IModelRouter {
  pass1(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }>;
  pass2(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }>;
  pass3(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }>;
  pass4(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }>;
  pass5(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }>;
  pass6(input: Pass6Input): Promise<{ output: Pass6Output; callLog: GeminiCallLogData }>;
  pass7(input: Pass7Input): Promise<{ output: Pass7Output; callLog: GeminiCallLogData }>;
  pass8(input: Pass8Input): Promise<{ output: Pass8Output; callLog: GeminiCallLogData }>;
  passDifferential(
    input: PassDifferentialInput,
  ): Promise<{ output: PassDifferentialOutput; callLog: GeminiCallLogData }>;
  passFindings(
    input: PassFindingsInput,
  ): Promise<{ output: PassFindingsOutput; callLog: GeminiCallLogData }>;
  passReasoning(
    input: PassReasoningInput,
  ): Promise<{ output: PassReasoningOutput; callLog: GeminiCallLogData }>;
}

// Re-export DTOs that consumers of @cureocity/llm need but don't yet
// pull from @cureocity/contracts directly.
export type { ClientDiagnosis, TreatmentPlan };
