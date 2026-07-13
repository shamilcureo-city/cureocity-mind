import { z } from 'zod';
import { CuidSchema } from './common';

// ============================================================================
// Cureocity Care — the standalone D2C AI-therapist product (sprints AC0+).
// See docs/AI_COUNSELING.md. These contracts are the API boundary for the
// /care surface: onboarding, the live-session lifecycle (start → redeem
// token → mirror turns → end), the kind-branched Pass 10 report, plan
// acceptance, check-ins, and instrument self-administration.
//
// CareReportV1 is a DISCRIMINATED UNION on `kind` — the same convention as
// Pass2Output/Pass3Output (Sprint 19). Always narrow before reading the body.
// ============================================================================

export const CareSessionKindSchema = z.enum(['INTAKE', 'TREATMENT', 'REVIEW']);
export type CareSessionKind = z.infer<typeof CareSessionKindSchema>;

export const CareSessionStatusSchema = z.enum([
  'CREATED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABORTED',
  'CRISIS_ESCALATED',
]);
export type CareSessionStatus = z.infer<typeof CareSessionStatusSchema>;

export const CareRiskLevelSchema = z.enum(['NONE', 'LOW', 'MODERATE', 'HIGH']);
export type CareRiskLevel = z.infer<typeof CareRiskLevelSchema>;

/// Which protocol family the plan draws from. Steps are sourced from the
/// @cureocity/clinical exercise catalog (clinician-authored, versioned with
/// the prompt — see packages/llm/src/prompts/care.ts).
export const CareModalityTrackSchema = z.enum([
  'CBT',
  'BEHAVIOURAL_ACTIVATION',
  'GROUNDING',
  'SLEEP',
]);
export type CareModalityTrack = z.infer<typeof CareModalityTrackSchema>;

/// The probe-verified Live voice set (docs/AI_COUNSELING.md §4.1).
export const CareVoiceNameSchema = z.enum(['Puck', 'Kore', 'Charon', 'Aoede']);
export type CareVoiceName = z.infer<typeof CareVoiceNameSchema>;

export const CarePersonaStyleSchema = z.enum(['gentle', 'direct']);
export type CarePersonaStyle = z.infer<typeof CarePersonaStyleSchema>;

// ============================================================================
// Onboarding
// ============================================================================

export const CareOnboardingInputSchema = z.object({
  displayName: z.string().min(1).max(80),
  personaName: z.string().min(1).max(40),
  voiceName: CareVoiceNameSchema,
  personaStyle: CarePersonaStyleSchema.default('gentle'),
  preferredLanguage: z.string().min(2).max(16).default('en'),
  spokenLanguages: z.array(z.string().min(2).max(16)).max(6).default([]),
  /// 18+ self-attestation — must be true to onboard.
  isAdult: z.literal(true),
  /// Plain-language consent (AI disclosure, recording → transcript,
  /// cross-border audio processing, retention, deletion). Versioned copy.
  consentAccepted: z.literal(true),
  /// §2 layer 2 — the baseline safety question. `true` = "yes, I am
  /// currently having thoughts of harming myself" → the server sets a
  /// SAFETY_HOLD and the client routes to hotlines + the licensed-
  /// therapist bridge instead of AI sessions.
  hasActiveSelfHarmThoughts: z.boolean(),
  trustedContactName: z.string().max(80).optional(),
  trustedContactPhone: z.string().max(24).optional(),
});
export type CareOnboardingInput = z.infer<typeof CareOnboardingInputSchema>;

export const CareSettingsInputSchema = z.object({
  personaName: z.string().min(1).max(40).optional(),
  voiceName: CareVoiceNameSchema.optional(),
  personaStyle: CarePersonaStyleSchema.optional(),
  preferredLanguage: z.string().min(2).max(16).optional(),
  spokenLanguages: z.array(z.string().min(2).max(16)).max(6).optional(),
  /// §4.4 — "give me more time to think". 400 is the floor, never lower.
  vadSilenceMs: z.number().int().min(400).max(1200).optional(),
  trustedContactName: z.string().max(80).nullable().optional(),
  trustedContactPhone: z.string().max(24).nullable().optional(),
});
export type CareSettingsInput = z.infer<typeof CareSettingsInputSchema>;

// ============================================================================
// Live session lifecycle
// ============================================================================

export const StartCareSessionInputSchema = z.object({
  /// 0–10 pre-session mood dial.
  moodBefore: z.number().int().min(0).max(10).optional(),
  /// Free-text topic ("just talk", "one thing on my mind: …"). The session
  /// KIND is inferred server-side — users never pick "intake".
  topic: z.string().max(200).optional(),
});
export type StartCareSessionInput = z.infer<typeof StartCareSessionInputSchema>;

export const StartCareSessionResponseSchema = z.object({
  sessionId: CuidSchema,
  kind: CareSessionKindSchema,
  /// Single-use redeem token (32 random bytes hex) — NOT the live credential.
  startToken: z.string().min(32),
  sessionCapMin: z.number().int().positive(),
});
export type StartCareSessionResponse = z.infer<typeof StartCareSessionResponseSchema>;

export const RedeemLiveTokenInputSchema = z.object({
  startToken: z.string().min(32).max(128),
});
export type RedeemLiveTokenInput = z.infer<typeof RedeemLiveTokenInputSchema>;

/**
 * The redeemed live credential, discriminated on transport mode:
 *  - `ephemeral` — AI Studio ephemeral auth token with the setup LOCKED
 *    server-side (system prompt never ships to the browser). Preferred.
 *  - `url`       — the source recipe's fallback: full WSS URL (key embedded)
 *    + the setup payload the browser must send verbatim on open.
 *  - `mock`      — local scripted WS server (dev/CI). Behaves like `url`.
 *  - `vertex`    — Vertex AI Live (LlmBidiService) in-region on the platform
 *    service account. Browser opens the Vertex WSS with a short-lived GCP
 *    access token in the query string; setup carries the full model path.
 */
export const RedeemLiveTokenResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ephemeral'),
    wsUrl: z.string().min(1),
    accessToken: z.string().min(1),
    expiresAtMs: z.number().int().positive(),
    /// The setup payload the browser sends on open. Present until the
    /// locked-liveConnectConstraints flow is probe-verified (AC0), at
    /// which point the server stops shipping it and the prompt stays
    /// fully server-side.
    setup: z.unknown().optional(),
  }),
  z.object({
    mode: z.literal('vertex'),
    wsUrl: z.string().min(1),
    /// The GCP OAuth access token (cloud-platform scope) the browser uses
    /// to open the Vertex Live socket. Short-lived; bounded to the session.
    accessToken: z.string().min(1),
    setup: z.unknown(),
    expiresAtMs: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('url'),
    wsUrl: z.string().min(1),
    setup: z.unknown(),
    expiresAtMs: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('mock'),
    wsUrl: z.string().min(1),
    setup: z.unknown(),
    expiresAtMs: z.number().int().positive(),
  }),
]);
export type RedeemLiveTokenResponse = z.infer<typeof RedeemLiveTokenResponseSchema>;

/// One stitched transcription turn, mirrored browser → server (§4.6).
export const CareTurnSchema = z.object({
  /// Monotonic per-session sequence number — server dedupes on it.
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'therapist']),
  text: z.string().max(4000),
  /// Milliseconds since session start.
  atMs: z.number().int().nonnegative(),
});
export type CareTurn = z.infer<typeof CareTurnSchema>;

export const MirrorTurnsInputSchema = z.object({
  turns: z.array(CareTurnSchema).min(1).max(50),
});
export type MirrorTurnsInput = z.infer<typeof MirrorTurnsInputSchema>;

/// The server's verdict after crisis-screening the batch. `crisis_stop`
/// obliges the client to hard-stop and show the crisis takeover.
export const MirrorTurnsResponseSchema = z.object({
  action: z.enum(['continue', 'crisis_stop']),
});
export type MirrorTurnsResponse = z.infer<typeof MirrorTurnsResponseSchema>;

export const EndCareSessionInputSchema = z.object({
  moodAfter: z.number().int().min(0).max(10).optional(),
});
export type EndCareSessionInput = z.infer<typeof EndCareSessionInputSchema>;

export const CareCrisisInputSchema = z.object({
  /// Where the escalation came from. The deterministic keyword screen is
  /// server-side; these two arrive from the client.
  source: z.enum(['model_tool', 'user_button']),
  reason: z.string().max(500).optional(),
});
export type CareCrisisInput = z.infer<typeof CareCrisisInputSchema>;

// ============================================================================
// Pass 10 — CareReportV1, discriminated on kind (docs/AI_COUNSELING.md §5)
// ============================================================================

/// INTERNAL — drives the safety-hold UX; never rendered as a raw score.
export const CareRiskScreenSchema = z
  .object({
    level: CareRiskLevelSchema.catch('NONE'),
    evidence: z.array(z.string().max(500)).catch([]),
  })
  .catch({ level: 'NONE', evidence: [] });
export type CareRiskScreen = z.infer<typeof CareRiskScreenSchema>;

export const CareProposedGoalSchema = z.object({
  goal: z.string().min(1).max(300),
  why: z.string().max(500).catch(''),
  measure: z.string().max(300).catch(''),
});
export type CareProposedGoal = z.infer<typeof CareProposedGoalSchema>;

export const CareAssessmentAndPlanSchema = z.object({
  /// Plain-language "what's going on and why it makes sense" — provisional
  /// wording, no ICD labels pronounced as fact.
  formulation: z.string().min(1),
  concernAreas: z
    .array(
      z.object({
        name: z.string().max(120),
        evidenceQuote: z.string().max(500).catch(''),
      }),
    )
    .catch([]),
  proposedGoals: z.array(CareProposedGoalSchema).min(1).max(6),
  modalityTrack: CareModalityTrackSchema.catch('CBT'),
  cadence: z.string().max(60).catch('weekly-25min'),
  riskScreen: CareRiskScreenSchema,
});
export type CareAssessmentAndPlan = z.infer<typeof CareAssessmentAndPlanSchema>;

export const CareSessionReportBodySchema = z.object({
  /// One warm sentence — the screenshot line.
  headline: z.string().max(200),
  /// What we worked on, second person, 3–5 sentences.
  summary: z.string(),
  insights: z
    .array(
      z.object({
        observation: z.string().max(500),
        evidenceQuote: z.string().max(500).catch(''),
      }),
    )
    .catch([]),
  goalProgress: z
    .array(
      z.object({
        goalIndex: z.number().int().nonnegative().catch(0),
        movement: z.enum(['FORWARD', 'NONE', 'BACK']).catch('NONE'),
        evidence: z.string().max(500).catch(''),
      }),
    )
    .catch([]),
  homework: z
    .object({
      title: z.string().max(200),
      steps: z.array(z.string().max(300)).catch([]),
      whyItHelps: z.string().max(500).catch(''),
    })
    .nullable()
    .catch(null),
  reflectionPrompt: z.string().max(500).catch(''),
  riskScreen: CareRiskScreenSchema,
});
export type CareSessionReportBody = z.infer<typeof CareSessionReportBodySchema>;

export const CareProgressReviewSchema = z.object({
  /// Reliable-change verdicts are COMPUTED by change-score.ts and passed
  /// INTO the pass; the model explains them, it never re-judges the numbers.
  verdicts: z
    .array(
      z.object({
        instrumentKey: z.string().max(16),
        baselineScore: z.number().int(),
        latestScore: z.number().int(),
        verdict: z.string().max(60),
        plainWords: z.string().max(400).catch(''),
      }),
    )
    .catch([]),
  goalOutcomes: z
    .array(
      z.object({
        goalIndex: z.number().int().nonnegative().catch(0),
        status: z.enum(['ACHIEVED', 'KEEP', 'REVISED']).catch('KEEP'),
        note: z.string().max(400).catch(''),
      }),
    )
    .catch([]),
  /// Empty = current goals stand; non-empty = the full revised goal list
  /// (re-versions CarePlan on user acceptance).
  revisedGoals: z.array(CareProposedGoalSchema).catch([]),
  recommendation: z.enum(['CONTINUE', 'STEP_DOWN', 'HUMAN_THERAPIST']).catch('CONTINUE'),
  narrative: z.string().catch(''),
  riskScreen: CareRiskScreenSchema,
});
export type CareProgressReview = z.infer<typeof CareProgressReviewSchema>;

export const CareReportV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('INTAKE'), assessmentAndPlan: CareAssessmentAndPlanSchema }),
  z.object({ kind: z.literal('TREATMENT'), sessionReport: CareSessionReportBodySchema }),
  z.object({ kind: z.literal('REVIEW'), progressReview: CareProgressReviewSchema }),
]);
export type CareReportV1 = z.infer<typeof CareReportV1Schema>;

// ============================================================================
// Plan acceptance — a USER action, not a model action (§5). The INTAKE /
// REVIEW branches only propose; this input persists the versioned CarePlan.
// ============================================================================

export const AcceptCarePlanInputSchema = z.object({
  /// The session whose report proposed this plan (INTAKE or REVIEW).
  sourceSessionId: CuidSchema,
  /// The user's (possibly edited) goal list.
  goals: z.array(CareProposedGoalSchema).min(1).max(6),
  modalityTrack: CareModalityTrackSchema,
  cadence: z.string().max(60).default('weekly-25min'),
});
export type AcceptCarePlanInput = z.infer<typeof AcceptCarePlanInputSchema>;

export const CarePlanGoalStatusSchema = z.enum(['ACTIVE', 'ACHIEVED', 'REVISED']);
export type CarePlanGoalStatus = z.infer<typeof CarePlanGoalStatusSchema>;

/// The persisted plan goal — proposal fields + live status.
export const CarePlanGoalSchema = CareProposedGoalSchema.extend({
  status: CarePlanGoalStatusSchema.default('ACTIVE'),
});
export type CarePlanGoal = z.infer<typeof CarePlanGoalSchema>;

// ============================================================================
// Check-ins + instruments
// ============================================================================

export const CareCheckinInputSchema = z.object({
  mood: z.number().int().min(0).max(10),
  note: z.string().max(120).optional(),
});
export type CareCheckinInput = z.infer<typeof CareCheckinInputSchema>;

export const CareInstrumentInputSchema = z.object({
  /// Keys from the @cureocity/clinical instruments registry.
  instrumentKey: z.enum(['PHQ9', 'GAD7']),
  /// item id → chosen scale value; validated against the registry server-side.
  answers: z.record(z.string(), z.number().int().min(0).max(3)),
});
export type CareInstrumentInput = z.infer<typeof CareInstrumentInputSchema>;

// ============================================================================
// Live wire protocol (subset) — validated by BOTH the browser client and
// services/care-mock-live so the mock stays honest to the recipe
// (snake_case serverContent messages; see docs/AI_COUNSELING.md §4.6).
// ============================================================================

export const CareLiveTranscriptionSchema = z.object({
  text: z.string(),
  finished: z.boolean().optional(),
});

export const CareLiveServerEventSchema = z.union([
  z.object({ setupComplete: z.object({}).passthrough() }),
  z.object({
    serverContent: z
      .object({
        input_transcription: CareLiveTranscriptionSchema.optional(),
        output_transcription: CareLiveTranscriptionSchema.optional(),
        turnComplete: z.boolean().optional(),
        interrupted: z.boolean().optional(),
        modelTurn: z
          .object({
            parts: z.array(
              z
                .object({
                  inlineData: z
                    .object({ mimeType: z.string().optional(), data: z.string() })
                    .optional(),
                })
                .passthrough(),
            ),
          })
          .optional(),
      })
      .passthrough(),
  }),
  z.object({
    toolCall: z.object({
      functionCalls: z.array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          args: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
  }),
]);
export type CareLiveServerEvent = z.infer<typeof CareLiveServerEventSchema>;
