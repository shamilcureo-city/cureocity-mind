import { z } from 'zod';
import { EvidenceRefSchema, MedicalEncounterNoteV1Schema } from './medical-note';
import { ClinicalOrderV1Schema, MedicationOrderV1Schema } from './medication-order';

/**
 * Sprint DV1 scaffold — the streaming / live contracts (Rails 1–3 of the
 * live copilot). STUB for the DV4 live-path sprint.
 * See docs/DOCTOR_VERTICAL.md §4, §6.
 */

/// Rail 1 — an interim/final ASR token delta.
export const LiveTranscriptDeltaSchema = z.object({
  text: z.string(),
  isFinal: z.boolean().default(false),
  speaker: z.enum(['doctor', 'patient', 'unknown']).default('unknown'),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
});
export type LiveTranscriptDelta = z.infer<typeof LiveTranscriptDeltaSchema>;

/**
 * Sprint DS0 — a finalized transcript window. The gateway no longer
 * re-transcribes the whole rolling buffer every cycle (that was O(n²) in
 * audio length + tokens). Instead it segments the stream at silence
 * boundaries (see services/live-gateway/src/vad.ts) and runs Pass 1 on
 * each NEW ~15–30s window exactly once, appending one Utterance per
 * window. Utterances are the durable record DS1's CaseState composer
 * consumes; the cumulative transcript is just their `text` joined.
 */
export const UtteranceSchema = z.object({
  /** Stable per-consult id (monotonic window index, e.g. "u1"). */
  id: z.string(),
  speaker: z.enum(['doctor', 'patient', 'unknown']).default('unknown'),
  text: z.string(),
  /** Window start offset from consult start, in ms. */
  tStartMs: z.number().int().nonnegative(),
  /** Window end offset from consult start, in ms. */
  tEndMs: z.number().int().nonnegative(),
});
export type Utterance = z.infer<typeof UtteranceSchema>;

/// Rail 2 — the incremental structured note, emitted repeatedly during
/// the consult. A partial of the final encounter note.
export const PartialStructuredNoteSchema = MedicalEncounterNoteV1Schema.partial();
export type PartialStructuredNote = z.infer<typeof PartialStructuredNoteSchema>;

/// Rail 3 — a live gap / red-flag / coding nudge surfaced mid-consult.
export const EncounterGapKindSchema = z.enum([
  'MISSING_QUESTION',
  'RED_FLAG',
  'DRUG_INTERACTION',
  'CODING',
]);
export type EncounterGapKind = z.infer<typeof EncounterGapKindSchema>;

export const EncounterGapSchema = z.object({
  kind: EncounterGapKindSchema,
  severity: z.enum(['info', 'warn', 'critical']).default('info'),
  message: z.string(),
  evidenceRef: EvidenceRefSchema.optional(),
});
export type EncounterGap = z.infer<typeof EncounterGapSchema>;

// ============================================================================
// Sprint DV6.4 — mid-consult voice commands. A deterministic parser (in
// @cureocity/clinical) scans the rolling transcript for spoken commands
// ("add paracetamol 500 TDS x 3 days", "order ECG", "show last HbA1c")
// and the gateway surfaces them as a `command` event. The doctor confirms;
// nothing is auto-applied. See docs/DOCTOR_VERTICAL_SPRINTS.md DV6.4.
// ============================================================================

export const VoiceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ADD_MEDICATION'),
    /** The transcript clause the command was parsed from. */
    raw: z.string(),
    drug: z.string(),
    strength: z.string().optional(),
    frequency: z.string().optional(),
    durationDays: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('ORDER_TEST'),
    raw: z.string(),
    description: z.string(),
  }),
  z.object({
    kind: z.literal('SHOW_DATA'),
    raw: z.string(),
    measure: z.enum(['BP', 'HBA1C', 'FBS', 'LDL', 'WEIGHT']),
  }),
]);
export type VoiceCommand = z.infer<typeof VoiceCommandSchema>;

// ============================================================================
// Sprint DS0 — per-consult token / cost / latency meter. The gateway can't
// touch the DB (no prisma dep — it's a standalone socket service), so it
// EMITS this summary as a `meter` event and the browser relays it to
// POST /sessions/:id/live-metric, which persists a LiveConsultMetric row.
// This is how we hold the unit economics honest: ≤ ₹2 / consult, transcript
// p95 ≤ 2s. costInr is a plain number (INR, ≤ 4 dp) — the DB column is the
// Decimal. Latencies are whole ms.
// ============================================================================
export const MeterSummarySchema = z.object({
  sessionId: z.string(),
  /** 'mock' | 'vertex' — which backend produced these numbers. */
  backend: z.string(),
  /** Finalized transcription windows so far. */
  windows: z.number().int().nonnegative(),
  pass1Calls: z.number().int().nonnegative(),
  pass2Calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costInr: z.number().nonnegative(),
  /** Pass-1 (transcription) latency percentiles across windows. */
  transcriptP50Ms: z.number().int().nonnegative(),
  transcriptP95Ms: z.number().int().nonnegative(),
  /** Pass-2 (note) latency percentiles across windows. */
  noteP50Ms: z.number().int().nonnegative(),
  noteP95Ms: z.number().int().nonnegative(),
  /** Wall-clock since the consult started. */
  elapsedMs: z.number().int().nonnegative(),
});
export type MeterSummary = z.infer<typeof MeterSummarySchema>;

// ============================================================================
// Sprint DV4 — live gateway wire protocol. The doctor's browser opens a
// WebSocket to the streaming gateway (a standalone in-region service —
// Vercel can't hold a socket). The gateway streams the three rails +
// lifecycle; the client sends start/stop. Both sides validate with these
// schemas. See docs/DOCTOR_VERTICAL.md §4 + services/live-gateway.
// ============================================================================

/// Client → gateway commands.
export const LiveGatewayCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    sessionId: z.string().optional(),
    specialty: z.string().optional(),
    /**
     * Sprint DV8 hardening — a short-lived signed token proving the
     * caller is the authenticated practitioner who owns `sessionId`
     * (minted by POST /sessions/:id/live-token). The gateway verifies it
     * before streaming. Optional in dev (gateway skips verification when
     * LIVE_GATEWAY_SECRET is unset); required in prod.
     */
    token: z.string().optional(),
  }),
  z.object({ type: z.literal('stop') }),
]);
export type LiveGatewayCommand = z.infer<typeof LiveGatewayCommandSchema>;

export const LiveGatewayStateSchema = z.enum([
  'connected',
  'listening',
  'finalizing',
  'done',
  // Sprint DV8 hardening — the start token was missing/invalid/expired.
  'unauthorized',
]);
export type LiveGatewayState = z.infer<typeof LiveGatewayStateSchema>;

/// Gateway → client events: the three rails + lifecycle status + (DV6.4)
/// recognised voice commands.
export const LiveGatewayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), state: LiveGatewayStateSchema }),
  z.object({ type: z.literal('transcript'), delta: LiveTranscriptDeltaSchema }),
  // Sprint DS0 — a finalized transcript window, emitted once per window as
  // the durable record (stable id + precise ms bounds). The `transcript`
  // delta still drives the running display; `utterance` is what DS1 builds
  // CaseState from.
  z.object({ type: z.literal('utterance'), utterance: UtteranceSchema }),
  z.object({ type: z.literal('note'), partial: PartialStructuredNoteSchema }),
  z.object({ type: z.literal('gap'), gap: EncounterGapSchema }),
  // Sprint DS0 — per-consult token / cost / latency rollup. Emitted after
  // each window + once at the end; the browser relays the last one to the
  // live-metric route.
  z.object({ type: z.literal('meter'), summary: MeterSummarySchema }),
  // Sprint DV9 — the closing note carries the drafted Rx + clinical
  // orders too, so the browser can persist a complete encounter (parity
  // with the batch path) for the doctor to sign.
  z.object({
    type: z.literal('final'),
    note: MedicalEncounterNoteV1Schema,
    medications: z.array(MedicationOrderV1Schema).default([]),
    orders: z.array(ClinicalOrderV1Schema).default([]),
  }),
  z.object({ type: z.literal('command'), command: VoiceCommandSchema }),
]);
export type LiveGatewayEvent = z.infer<typeof LiveGatewayEventSchema>;

/**
 * Sprint DV9 — POST /sessions/:id/live-note body. The browser relays the
 * gateway's finalized note + drafted orders so the live consult lands as
 * a persisted NoteDraft (COMPLETED) the doctor reviews + signs — the same
 * provenance as the batch path (AI-drafted → doctor-attested).
 */
export const LiveNoteInputSchema = z.object({
  note: MedicalEncounterNoteV1Schema,
  medications: z.array(MedicationOrderV1Schema).default([]),
  orders: z.array(ClinicalOrderV1Schema).default([]),
});
export type LiveNoteInput = z.infer<typeof LiveNoteInputSchema>;
